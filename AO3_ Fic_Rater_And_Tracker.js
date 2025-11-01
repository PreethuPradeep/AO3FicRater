// ==UserScript==
// @name         AO3 Fic Rater & Tracker
// @description  Adds Kudos/Hits ratio, read highlighting (red), custom ratings, and update tracking to AO3.
// @namespace    https://github.com/PreethuPradeep/AO3FicRater
// @author       PeetaMellark
// @version      3.2.3
// @history      3.2.3 - fixed infinite retry loop by implementing max retry limit per page (5 attempts) with exponential backoff
// @history      3.2.2 - added retry logic for first page fetch to handle rate limiting from page load
// @history      3.2.1 - fixed rate limiting issues by increasing delay to 2.5s and adding 429 retry logic
// @history      3.2.0 - added bookmarks extraction and highlighting on search/history pages
// @history      3.1.0 - Removed all kudos-tracking features to focus on read history. Fixed variable scope bug (stats_page). Fixed sync pagination bug (now finds all pages).
// @history      3.0.1 - Added extensive console.log messages for debugging all features.
// @history      3.0.0 - Complete rewrite. Added 2-mode sync (History + Kudos). Added manual "Mark as Read" button to enable update tracking.
// @homepageURL  https://github.com/PreethuPradeep/AO3FicRater
// @downloadURL  https://raw.githubusercontent.com/PreethuPradeep/AO3FicRater/main/AO3_Fic_Rater.user.js
// @updateURL    https://raw.githubusercontent.com/PreethuPradeep/AO3FicRater/main/AO3_Fic_Rater.user.js
// @match        https://archiveofourown.org/*
// @match        https://archiveofourown.gay/*
// @icon         data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==
// @require      https://ajax.googleapis.com/ajax/libs/jquery/1.9.0/jquery.min.js
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_deleteValue
// @grant        GM_xmlhttpRequest
// @connect      archiveofourown.org
// @connect      archiveofourown.gay
// ==/UserScript==

// ~~ SETTINGS ~~ //

// count kudos/hits automatically: true/false
var always_count = true;

// sort works on this page by kudos/hits ratio in descending order automatically: true/false
var always_sort = false;

// hide hitcount: true/false
var hide_hitcount = true;

// highlight works already read from history: true/false
var highlight_read = true;

// colour background depending on percentage: true/false
var colourbg = true;

// lvl1 & lvl2 - percentage levels separating red, yellow and green background; ratio_red, ratio_yellow, ratio_green - background colours
var ratio_red = '#ffdede';
var lvl1 = 4;
var ratio_yellow = '#fdf2a3';
var lvl2 = 7;
var ratio_green = '#c4eac3';

// highlight color for read works
var read_highlight_color = 'rgba(255, 0, 0, 0.1)';

// highlight color for bookmarked works
var bookmark_highlight_color = 'rgba(0, 128, 255, 0.1)';

// AO3 theme colors and styles
var ao3_bg = '#f8f8f8';
var ao3_text = '#333333';
var ao3_accent = '#900';
var ao3_border = '#d0d0d0';
var ao3_secondary = '#666';

// ~~ END OF SETTINGS ~~ //

// Global storage for read works
var readWorksSet = new Set();
var readWorksExtracted = false;

// Global storage for bookmarked works
var bookmarkedWorksSet = new Set();
var bookmarksExtracted = false;

// Global storage for work metadata (ratings, last read date, last read chapters)
var workMetadata = {};

// Tracking for background sync
var syncInProgress = false;
var lastSyncTime = null;
var syncCheckInterval = null;



// STUFF HAPPENS BELOW //

(function ($) {

    // check user settings
    if (typeof (Storage) !== 'undefined') {

        var always_count_set = localStorage.getItem('alwayscountlocal');
        var always_sort_set = localStorage.getItem('alwayssortlocal');
        var hide_hitcount_set = localStorage.getItem('hidehitcountlocal');
        var highlight_read_set = localStorage.getItem('highlightreadlocal');

        if (always_count_set == 'no') {
            always_count = false;
        }

        if (always_sort_set == 'yes') {
            always_sort = true;
        }

        if (hide_hitcount_set == 'no') {
            hide_hitcount = false;
        }

        if (highlight_read_set == 'no') {
            highlight_read = false;
        }
    }

    // set defaults for countableness and sortableness
        var countable = false;
        var sortable = false;
        var stats_page = false;

    // check if it's a list of works or bookmarks, or header on work page, and attach the menu
        checkCountable();
        
    // Extract read works from history
    extractReadWorks();
    
    // Extract bookmarked works
    extractBookmarks();

    // Start automatic background sync if on AO3
    startAutoSync();

    // if set to automatic
        if (always_count) {
            countRatio();

            if (always_sort) {
                sortByRatio();
            }
        }

    // Highlight read works if enabled
        if (highlight_read && readWorksExtracted) {
            highlightReadWorks();
        }

    // Highlight bookmarked works if enabled
        if (bookmarksExtracted) {
            highlightBookmarkedWorks();
        }

    // Display ratings if enabled
        displayRatingsAndUpdates();
    
    // Set up click tracking for highlighted works
        setupWorkClickTracking();




    // check if it's a list of works/bookmarks/statistics, or header on work page
    function checkCountable() {

        var found_stats = $('dl.stats');

        if (found_stats.length) {

            if (found_stats.closest('li').is('.work') || found_stats.closest('li').is('.bookmark')) {
                countable = true;
                sortable = true;

                addRatioMenu();
            }
            else if (found_stats.parents('.statistics').length) {
                countable = true;
                sortable = true;
                stats_page = true;

                addRatioMenu();
            }
            else if (found_stats.parents('dl.work').length) {
                countable = true;

                addRatioMenu();
            }
        }
    }


    function countRatio() {

        if (countable) {

            $('dl.stats').each(function () {

                var hits_value = $(this).find('dd.hits');
                var kudos_value = $(this).find('dd.kudos');

                // if hits and kudos were found
                if (kudos_value.length && hits_value.length && hits_value.text() !== '0') {

                    // get counts
                    var hits_count = parseInt(hits_value.text().replace(/\D/g, ''));
                    var kudos_count = parseInt(kudos_value.text().replace(/\D/g, ''));

                    // count percentage
                    var percents = 100 * kudos_count / hits_count;

                    // get percentage with one decimal point
                    var percents_print = percents.toFixed(1).replace('.', ',');
                    // add ratio stats
                    var ratio_label = $('<dt class="kudoshits"></dt>').text('Kudos/Hits:');
                    var ratio_value = $('<dd class="kudoshits"></dd>').text(percents_print + '%').css('font-weight', 'bold');
                    hits_value.after(ratio_label, ratio_value);

                    if (colourbg) {
                        // colour background depending on percentage
                        if (percents >= lvl2) {
                            ratio_value.css('background-color', ratio_green);
                        }
                        else if (percents >= lvl1) {
                            ratio_value.css('background-color', ratio_yellow);
                        }
                        else {
                            ratio_value.css('background-color', ratio_red);
                        }
                    }

                    if (hide_hitcount && !stats_page) {
                        // hide hitcount label and value
                        $(this).find('.hits').css('display', 'none');
                    }

                    // add attribute to the blurb for sorting
                    $(this).closest('li').attr('kudospercent', percents);
                }
                else {
                    // add attribute to the blurb for sorting
                    $(this).closest('li').attr('kudospercent', 0);
                }
            });
        }
    }


    function sortByRatio(ascending) {

        if (sortable) {

            var sortable_lists = $('dl.stats').closest('li').parent();

            sortable_lists.each(function () {

                var list_elements = $(this).children('li');

                // sort by kudos/hits ratio in descending order
                list_elements.sort(function (a, b) {
                    return parseFloat(b.getAttribute('kudospercent')) - parseFloat(a.getAttribute('kudospercent'));
                });

                if (ascending) {
                    $(list_elements.get().reverse()).detach().appendTo($(this));
                }
                else {
                    list_elements.detach().appendTo($(this));
                }
            });
        }
    }

    // Sort works by rating
    function sortByRating(ascending) {
        if (sortable) {
            var sortable_lists = $('dl.stats').closest('li').parent();

            sortable_lists.each(function () {
                var list_elements = $(this).children('li');

                // Get ratings for sorting
                list_elements.each(function() {
                    var $element = $(this);
                    var workLink = $element.find('h4.heading a, dd.chapters a, a').first().attr('href');
                    if (workLink && workLink.indexOf('/works/') !== -1) {
                        var workIdMatch = workLink.match(/\/works\/(\d+)/);
                        if (workIdMatch && workIdMatch[1]) {
                            var metadata = workMetadata[workIdMatch[1]] || {};
                            var rating = metadata.rating !== undefined ? metadata.rating : -1;
                            $element.attr('custom-rating', rating);
                        }
                    }
                });

                // sort by rating
                list_elements.sort(function (a, b) {
                    return parseFloat(b.getAttribute('custom-rating')) - parseFloat(a.getAttribute('custom-rating'));
                });

                if (ascending) {
                    $(list_elements.get().reverse()).detach().appendTo($(this));
                }
                else {
                    list_elements.detach().appendTo($(this));
                }
            });
        }
    }


    // attach the menu
    function addRatioMenu() {

        // get the header menu
        var header_menu = $('ul.primary.navigation.actions');

        // create and insert menu button
        var ratio_menu = $('<li class="dropdown"></li>').html('<a>Ratings & Stats</a>');
        header_menu.find('li.search').before(ratio_menu);

        // create and append dropdown menu
        var drop_menu = $('<ul class="menu dropdown-menu"></li>');
        ratio_menu.append(drop_menu);

        // create button - count
        var button_count = $('<li></li>').html('<a>Count on this page</a>');
        button_count.click(function () { countRatio(); });

        // create button - sort by ratio
        var button_sort = $('<li></li>').html('<a>Sort by kudos/hits ratio</a>');
        button_sort.click(function () { sortByRatio(); });

        // create button - sort by rating
        var button_sort_rating = $('<li></li>').html('<a>Sort by rating</a>');
        button_sort_rating.click(function () { sortByRating(); });

        // create button - settings separator
        var button_settings = $('<li></li>').html('<a style="padding: 0.5em 0.5em 0.25em; text-align: center; font-weight: bold; border-bottom: 1px solid ' + ao3_border + '; display: block; color: ' + ao3_text + ';">Settings</a>');

        // create button - always count
        var button_count_yes = $('<li class="count-yes"></li>').html('<a>Count automatically: YES</a>');
        drop_menu.on('click', 'li.count-yes', function () {
            localStorage.setItem('alwayscountlocal', 'no');
            button_count_yes.replaceWith(button_count_no);
        });

        // create button - not always count
        var button_count_no = $('<li class="count-no"></li>').html('<a>Count automatically: NO</a>');
        drop_menu.on('click', 'li.count-no', function () {
            localStorage.setItem('alwayscountlocal', 'yes');
            button_count_no.replaceWith(button_count_yes);
        });

        // create button - always sort
        var button_sort_yes = $('<li class="sort-yes"></li>').html('<a>Sort automatically: YES</a>');
        drop_menu.on('click', 'li.sort-yes', function () {
            localStorage.setItem('alwayssortlocal', 'no');
            button_sort_yes.replaceWith(button_sort_no);
        });

        // create button - not always sort
        var button_sort_no = $('<li class="sort-no"></li>').html('<a>Sort automatically: NO</a>');
        drop_menu.on('click', 'li.sort-no', function () {
            localStorage.setItem('alwayssortlocal', 'yes');
            button_sort_no.replaceWith(button_sort_yes);
        });

        // create button - hide hitcount
        var button_hide_yes = $('<li class="hide-yes"></li>').html('<a>Hide hitcount: YES</a>');
        drop_menu.on('click', 'li.hide-yes', function () {
            localStorage.setItem('hidehitcountlocal', 'no');
            $('.stats .hits').css('display', '');
            button_hide_yes.replaceWith(button_hide_no);
        });

        // create button - don't hide hitcount
        var button_hide_no = $('<li class="hide-no"></li>').html('<a>Hide hitcount: NO</a>');
        drop_menu.on('click', 'li.hide-no', function () {
            localStorage.setItem('hidehitcountlocal', 'yes');
            $('.stats .hits').css('display', 'none');
            button_hide_no.replaceWith(button_hide_yes);
        });

        // create button - highlight read
        var button_highlight_yes = $('<li class="highlight-yes"></li>').html('<a>Highlight read: YES</a>');
        drop_menu.on('click', 'li.highlight-yes', function () {
            localStorage.setItem('highlightreadlocal', 'no');
            $('li.work.blurb').css({
                'background-color': '',
                'border-left': '',
                'margin-left': ''
            });
            button_highlight_yes.replaceWith(button_highlight_no);
        });

        // create button - don't highlight read
        var button_highlight_no = $('<li class="highlight-no"></li>').html('<a>Highlight read: NO</a>');
        drop_menu.on('click', 'li.highlight-no', function () {
            localStorage.setItem('highlightreadlocal', 'yes');
            if (readWorksExtracted) {
                highlightReadWorks();
            }
            if (bookmarksExtracted) {
                highlightBookmarkedWorks();
            }
            button_highlight_no.replaceWith(button_highlight_yes);
        });

        // create button - refresh read works
        var button_refresh = $('<li class="refresh-reads"></li>').html('<a style="color: ' + ao3_accent + ';">🔄 Refresh read works</a>');
        drop_menu.on('click', 'li.refresh-reads', function () {
            readWorksSet.clear();
            localStorage.removeItem('ao3_read_works');
            localStorage.removeItem('ao3_sync_in_progress');
            localStorage.removeItem('ao3_last_sync');
            alert('Local read works data cleared. Please navigate to your AO3 Reading History page (any page) to rebuild it. The script will automatically extract all pages.');
        });

        // create button - sync full history (uses manual sync function)
        var button_sync_full = $('<li class="full-history-sync"></li>').html('<a style="color: ' + ao3_accent + '; font-weight: bold;">🔄 Sync Full History</a>');
        drop_menu.on('click', 'li.full-history-sync', function () {
            // Clear sync flags to allow restart
            localStorage.removeItem('ao3_sync_in_progress');
            syncInProgress = false;
            // Use the automatic background extraction function
            backgroundExtractHistory();
        });

        // create button - sync bookmarks
        var button_sync_bookmarks = $('<li class="sync-bookmarks"></li>').html('<a style="color: #0080ff; font-weight: bold;">📑 Sync Bookmarks</a>');
        drop_menu.on('click', 'li.sync-bookmarks', function () {
            // Use the automatic background bookmarks extraction function
            backgroundExtractBookmarks();
        });

        // append buttons to the dropdown menu
        drop_menu.append(button_count);

        if (sortable) {
            drop_menu.append(button_sort);
            drop_menu.append(button_sort_rating);
        }

        if (typeof (Storage) !== 'undefined') {

        drop_menu.append(button_settings);

            if (always_count) {
                drop_menu.append(button_count_yes);
            }
            else {
                drop_menu.append(button_count_no);
            }

            if (always_sort) {
                drop_menu.append(button_sort_yes);
            }
            else {
                drop_menu.append(button_sort_no);
            }

            if (hide_hitcount) {
                drop_menu.append(button_hide_yes);
            }
            else {
                drop_menu.append(button_hide_no);
            }

            if (highlight_read) {
                drop_menu.append(button_highlight_yes);
            }
            else {
                drop_menu.append(button_highlight_no);
            }

        drop_menu.append(button_refresh);
        drop_menu.append(button_sync_full);
        drop_menu.append(button_sync_bookmarks);
        }

        // add button for statistics
        if ($('#main').is('.stats-index')) {

            var button_sort_stats = $('<li></li>').html('<a>↓&nbsp;Kudos/hits</a>');
            button_sort_stats.click(function () {
                sortByRatio();
                button_sort_stats.after(button_sort_stats_asc).detach();
            });

            var button_sort_stats_asc = $('<li></li>').html('<a>↑&nbsp;Kudos/hits</a>');
            button_sort_stats_asc.click(function () {
                sortByRatio(true);
                button_sort_stats_asc.after(button_sort_stats).detach();
            });

            $('ul.sorting.actions li:nth-child(3)').after(button_sort_stats);
        }
    }


    // Extract read works from AO3 history
    function extractReadWorks() {
        // Check if we're on a history page or if we need to navigate there
        var currentUrl = window.location.href;
        
        // If on history page, extract works and save URL
        if (currentUrl.indexOf('/users/') !== -1 && currentUrl.indexOf('/readings') !== -1) {
            // Store the history URL for future background syncs
            var historyUrl = currentUrl.split('?')[0]; // Remove page parameter
            localStorage.setItem('ao3_history_url', historyUrl);
            
            // Extract from current page first
            extractFromCurrentPage();
            readWorksExtracted = true;
            
            // Automatically start background sync of ALL history pages
            // Only if not already syncing
            if (!syncInProgress) {
                backgroundExtractHistory();
            }
        } else if (currentUrl.indexOf('/users/') !== -1 && currentUrl.indexOf('/works') !== -1) {
            // On user's works page - extract but don't auto-sync
            extractFromCurrentPage();
            readWorksExtracted = true;
        } else {
            // Try to get history from localStorage if previously extracted
            var storedReadWorks = localStorage.getItem('ao3_read_works');
            if (storedReadWorks) {
                try {
                    var workIds = JSON.parse(storedReadWorks);
                    readWorksSet = new Set(workIds);
                    readWorksExtracted = true;
                } catch (e) {
                    console.log('Failed to parse stored read works');
                }
            }
            
            // Load work metadata (ratings, last read info)
            var storedMetadata = localStorage.getItem('ao3_work_metadata');
            if (storedMetadata) {
                try {
                    workMetadata = JSON.parse(storedMetadata);
                } catch (e) {
                    console.log('Failed to parse stored work metadata');
                }
            }
        }
    }

    // Scrape work IDs from HTML string - ONLY from main title links
    function scrapeWorkIdsFromHTML(htmlToScrape) {
        var workIds = new Set();
        var $html = $(htmlToScrape);
        
        // ONLY find main work title links in history/search pages (not tags, authors, etc.)
        // This selector targets the main heading link which is the actual work
        // Use .blurb class to ensure we're only getting work listings, not other elements
        $html.find('li.work.blurb h4.heading a, li.bookmark h4.heading a').each(function() {
            var workLink = $(this).attr('href');
            if (workLink && workLink.indexOf('/works/') !== -1) {
                var workIdMatch = workLink.match(/\/works\/(\d+)/);
                if (workIdMatch && workIdMatch[1]) {
                    var workId = workIdMatch[1];
                    // Only add if it's a valid numeric ID
                    if (/^\d+$/.test(workId)) {
                        workIds.add(workId);
                    }
                }
            }
        });
        
        return workIds;
    }

    // Extract work IDs from current page
    function extractFromCurrentPage() {
        var foundIds = scrapeWorkIdsFromHTML($(document));
        
        var newIdsCount = 0;
        
        // Add found IDs to global readWorksSet
        foundIds.forEach(function(id) {
            if (!readWorksSet.has(id)) {
                readWorksSet.add(id);
                newIdsCount++;
            }
        });

        // Save to localStorage
        if (readWorksSet.size > 0) {
            localStorage.setItem('ao3_read_works', JSON.stringify([...readWorksSet]));
        }
        
        if (newIdsCount > 0) {
            console.log('Extracted ' + newIdsCount + ' new work IDs (total: ' + readWorksSet.size + ')');
        }
    }

    // Sync full history by fetching all pages
    async function syncFullHistory(buttonElement) {
        try {
            // Find the user's history URL
                var historyLink = $('a[href^="/users/"][href*="/readings"]').first();
            if (historyLink.length === 0) {
                // Try alternative selector
                historyLink = $('a[href*="/readings"]').first();
            }
            
            if (historyLink.length === 0) {
                alert('Could not find your history URL. Please navigate to your history page once and try again.');
                    return;
                }
            
            var baseUrl = historyLink.attr('href');
            if (!baseUrl) {
                alert('Could not find your history URL. Please navigate to your history page once and try again.');
                return;
            }
            
            // Make sure URL is absolute
            if (baseUrl.indexOf('http') !== 0) {
                baseUrl = window.location.origin + baseUrl;
            }

            // Fetch the first page to get total page count
            buttonElement.find('a').text('Syncing... Fetching page 1...');
            
            var firstPageResponse;
            var retries = 0;
            while (retries < 3) {
                firstPageResponse = await fetch(baseUrl);
                if (firstPageResponse.ok) {
                    break;
                } else if (firstPageResponse.status === 429 && retries < 2) {
                    console.warn('Rate limited on first page. Waiting 10 seconds...');
                    buttonElement.find('a').text('Rate limited on page 1... waiting...');
                    await new Promise(function(resolve) {
                        setTimeout(resolve, 10000);
                    });
                    retries++;
                } else {
                    throw new Error('Failed to fetch history page: ' + firstPageResponse.status);
                }
            }
            
            var firstPageHTML = await firstPageResponse.text();
            var $firstPage = $(firstPageHTML);
            
            // Extract work IDs from first page
            var firstPageIds = scrapeWorkIdsFromHTML(firstPageHTML);
            firstPageIds.forEach(function(id) {
                readWorksSet.add(id);
            });
            
            // Find total number of pages from pagination
            var totalPages = 1;
            var $pagination = $firstPage.find('ol.pagination');
            if ($pagination.length > 0) {
                var $lastPageLink = $pagination.find('li:last-child a');
                if ($lastPageLink.length > 0) {
                    var lastPageText = $lastPageLink.text().trim();
                    var pageMatch = lastPageText.match(/(\d+)/);
                    if (pageMatch && pageMatch[1]) {
                        totalPages = parseInt(pageMatch[1]);
                    }
                }
            }
            
            // Alert user about the sync process
            alert('Starting full history sync for ' + totalPages + ' pages. This will take several minutes. Please leave this tab open.');
            
            // Loop through all pages
            for (var page = 2; page <= totalPages; page++) {
                var pageSuccess = false;
                var retryCount = 0;
                var maxRetries = 5;
                
                // Keep retrying this page until success or max retries
                while (!pageSuccess && retryCount < maxRetries) {
                    // Throttle: wait 2.5 seconds between requests to avoid rate limiting
                    await new Promise(function(resolve) {
                        setTimeout(resolve, 2500);
                    });
                    
                    try {
                        // Construct page URL
                        var pageUrl = baseUrl;
                        if (pageUrl.indexOf('?') !== -1) {
                            pageUrl = pageUrl.replace(/\?.*$/, '') + '?page=' + page;
                        } else {
                            pageUrl = pageUrl + '?page=' + page;
                        }
                        
                        // Update button text with progress
                        if (retryCount > 0) {
                            buttonElement.find('a').text('Retrying page ' + page + '/' + totalPages + ' (attempt ' + (retryCount + 1) + ')...');
                        } else {
                            buttonElement.find('a').text('Syncing page ' + page + '/' + totalPages + '...');
                        }
                        
                        // Fetch the page
                        var pageResponse = await fetch(pageUrl);
                        if (pageResponse.ok) {
                            var pageHTML = await pageResponse.text();
                            
                            // Extract work IDs from this page
                            var pageIds = scrapeWorkIdsFromHTML(pageHTML);
                            pageIds.forEach(function(id) {
                                readWorksSet.add(id);
                            });
                            
                            pageSuccess = true;
                        } else if (pageResponse.status === 429) {
                            // Rate limited - wait longer
                            console.warn('Rate limited on page ' + page + '. Waiting 15 seconds...');
                            buttonElement.find('a').text('Rate limited on page ' + page + '... waiting...');
                            await new Promise(function(resolve) {
                                setTimeout(resolve, 15000);
                            });
                            retryCount++;
                        } else {
                            console.warn('Failed to fetch page ' + page + ': ' + pageResponse.status);
                            break; // Skip this page, move to next
                        }
                    } catch (error) {
                        console.warn('Error fetching page ' + page + ':', error);
                        retryCount++;
                    }
                }
                
                if (!pageSuccess && retryCount >= maxRetries) {
                    console.error('Failed to fetch page ' + page + ' after ' + maxRetries + ' retries. Moving to next page.');
                }
            }
            
            // Save complete set to localStorage
            localStorage.setItem('ao3_read_works', JSON.stringify([...readWorksSet]));
            
            // Reset button text and show completion message
            buttonElement.find('a').text('🔄 Sync Full History');
            alert('Full history sync complete! ' + readWorksSet.size + ' works have been saved. Please refresh the page to see highlights.');
            
            // Refresh highlights if enabled
            if (highlight_read) {
            readWorksExtracted = true;
            highlightReadWorks();
            }
            if (bookmarksExtracted) {
                highlightBookmarkedWorks();
            }
            
        } catch (error) {
            console.error('Error during full history sync:', error);
            buttonElement.find('a').text('🔄 Sync Full History');
            alert('Error during sync: ' + error.message + '. Some works may have been saved. Please try again.');
        }
    }

    // Highlight works that have been read (only on search pages)
    function highlightReadWorks() {
        // Only highlight if we have extracted read works
        if (!readWorksExtracted || readWorksSet.size === 0) {
            return;
        }
        
        var currentUrl = window.location.href;
        
        // Skip if on user pages (readings, bookmarks, works, etc)
        if (currentUrl.indexOf('/users/') !== -1) {
            return;
        }
        
        // Skip if on individual work pages
        if (currentUrl.match(/\/works\/\d+$/) || currentUrl.match(/\/works\/\d+\?/)) {
            return;
        }
        
        // Only highlight on works search/browse pages
        if (currentUrl.indexOf('/works') === -1) {
            return;
        }
        
        var highlightedCount = 0;
        
        $('li.work.blurb, li.bookmark').each(function() {
            var $work = $(this);
            // Only look at the main heading link for the work, not all links
            var workLink = $work.find('h4.heading a').first().attr('href');
            
            if (workLink && workLink.indexOf('/works/') !== -1) {
                var workIdMatch = workLink.match(/\/works\/(\d+)/);
                if (workIdMatch && workIdMatch[1]) {
                    var workId = workIdMatch[1];
                    // Only highlight if work ID exists in read set
                    if (readWorksSet.has(workId)) {
                    $work.css('background-color', read_highlight_color);
                    $work.css('border-left', '3px solid ' + ao3_accent);
                    $work.css('margin-left', '-3px');
                    $work.css('padding-left', '8px');
                        highlightedCount++;
                    }
                }
            }
        });
        
        if (highlightedCount > 0) {
            console.log('Highlighted ' + highlightedCount + ' read works out of ' + readWorksSet.size + ' total in history');
        }
    }

    // Extract bookmarked works from AO3 bookmarks page
    function extractBookmarks() {
        var currentUrl = window.location.href;
        
        // If on bookmarks page, extract works and save URL
        if (currentUrl.indexOf('/bookmarks') !== -1) {
            // Store the bookmarks URL for future background syncs
            var bookmarksUrl = currentUrl.split('?')[0]; // Remove page parameter
            localStorage.setItem('ao3_bookmarks_url', bookmarksUrl);
            
            // Extract from current page
            extractBookmarksFromCurrentPage();
            bookmarksExtracted = true;
            
            // Automatically start background sync of ALL bookmarks pages after a delay
            setTimeout(function() {
                backgroundExtractBookmarks();
            }, 2000);
        } else {
            // Try to get bookmarks from localStorage if previously extracted
            var storedBookmarks = localStorage.getItem('ao3_bookmarks');
            if (storedBookmarks) {
                try {
                    var bookmarkIds = JSON.parse(storedBookmarks);
                    bookmarkedWorksSet = new Set(bookmarkIds);
                    bookmarksExtracted = true;
                } catch (e) {
                    console.log('Failed to parse stored bookmarks');
                }
            }
        }
    }

    // Extract bookmark IDs from current page
    function extractBookmarksFromCurrentPage() {
        var foundIds = scrapeWorkIdsFromHTML($(document));
        
        var newIdsCount = 0;
        
        // Add found IDs to global bookmarkedWorksSet
        foundIds.forEach(function(id) {
            if (!bookmarkedWorksSet.has(id)) {
                bookmarkedWorksSet.add(id);
                newIdsCount++;
            }
        });

        // Save to localStorage
        if (bookmarkedWorksSet.size > 0) {
            localStorage.setItem('ao3_bookmarks', JSON.stringify([...bookmarkedWorksSet]));
        }
        
        if (newIdsCount > 0) {
            console.log('Extracted ' + newIdsCount + ' new bookmark IDs (total: ' + bookmarkedWorksSet.size + ')');
        }
    }

    // Background extraction of all bookmarks pages
    async function backgroundExtractBookmarks() {
        try {
            var baseUrl = localStorage.getItem('ao3_bookmarks_url');
            if (!baseUrl) {
                baseUrl = window.location.href.split('?')[0];
                localStorage.setItem('ao3_bookmarks_url', baseUrl);
            }
            
            // Make sure URL is absolute
            if (baseUrl.indexOf('http') !== 0) {
                baseUrl = window.location.origin + baseUrl;
            }
            
            console.log('Starting automatic bookmarks extraction from: ' + baseUrl);
            
            // First, fetch page 1 to get total page count
            var firstPageResponse;
            var retries = 0;
            while (retries < 3) {
                firstPageResponse = await fetch(baseUrl + '?page=1');
                if (firstPageResponse.ok) {
                    break;
                } else if (firstPageResponse.status === 429 && retries < 2) {
                    console.warn('Rate limited on first page. Waiting 10 seconds...');
                    await new Promise(function(resolve) {
                        setTimeout(resolve, 10000);
                    });
                    retries++;
                } else {
                    throw new Error('Failed to fetch first page: ' + firstPageResponse.status);
                }
            }
            
            var firstPageHTML = await firstPageResponse.text();
            var $firstPage = $(firstPageHTML);
            
            // Extract bookmark IDs from first page
            var firstPageIds = scrapeWorkIdsFromHTML(firstPageHTML);
            firstPageIds.forEach(function(id) {
                bookmarkedWorksSet.add(id);
            });
            console.log('Page 1: Extracted ' + firstPageIds.size + ' bookmarks (total: ' + bookmarkedWorksSet.size + ')');
            
            // Find total pages from pagination
            var totalPages = 1;
            var $pagination = $firstPage.find('ol.pagination');
            
            if ($pagination.length > 0) {
                // Method 1: Last pagination link
                var $lastPageLink = $pagination.find('li:last-child a');
                if ($lastPageLink.length > 0) {
                    var lastPageText = $lastPageLink.text().trim();
                    var pageMatch = lastPageText.match(/(\d+)/);
                    if (pageMatch && pageMatch[1]) {
                        totalPages = parseInt(pageMatch[1]);
                    }
                }
                
                // Method 2: If no last link, try finding highest page number
                if (totalPages === 1) {
                    $pagination.find('li a').each(function() {
                        var linkText = $(this).text().trim();
                        var match = linkText.match(/^(\d+)$/);
                        if (match && match[1]) {
                            var pageNum = parseInt(match[1]);
                            if (pageNum > totalPages) {
                                totalPages = pageNum;
                            }
                        }
                    });
                }
            }
            
            // If still 1 page, also check current page pagination
            if (totalPages === 1 && window.location.href.indexOf('/bookmarks') !== -1) {
                var $currentPagination = $('ol.pagination');
                if ($currentPagination.length > 0) {
                    var $lastLink = $currentPagination.find('li:last-child a');
                    if ($lastLink.length > 0) {
                        var lastText = $lastLink.text().trim();
                        var match = lastText.match(/(\d+)/);
                        if (match && match[1]) {
                            totalPages = parseInt(match[1]);
                        }
                    }
                }
            }
            
            if (totalPages > 1) {
                console.log('Detected ' + totalPages + ' total bookmark pages. Starting background sync...');
                
                // Save progress after first page
                localStorage.setItem('ao3_bookmarks', JSON.stringify([...bookmarkedWorksSet]));
                
                // Fetch all remaining pages
                for (var page = 2; page <= totalPages; page++) {
                    var pageSuccess = false;
                    var retryCount = 0;
                    var maxRetries = 5;
                    
                    // Keep retrying this page until success or max retries
                    while (!pageSuccess && retryCount < maxRetries) {
                        // Throttle: wait 2.5 seconds between requests to avoid rate limiting
                        await new Promise(function(resolve) {
                            setTimeout(resolve, 2500);
                        });
                        
                        try {
                            var pageUrl = baseUrl + '?page=' + page;
                            if (retryCount > 0) {
                                console.log('Retrying bookmarks page ' + page + '/' + totalPages + ' (attempt ' + (retryCount + 1) + ')...');
                            } else {
                                console.log('Fetching bookmarks page ' + page + '/' + totalPages + '...');
                            }
                            
                            var pageResponse = await fetch(pageUrl);
                            
                            if (pageResponse.ok) {
                                var pageHTML = await pageResponse.text();
                                var pageIds = scrapeWorkIdsFromHTML(pageHTML);
                                var newIdsOnPage = 0;
                                
                                pageIds.forEach(function(id) {
                                    if (!bookmarkedWorksSet.has(id)) {
                                        bookmarkedWorksSet.add(id);
                                        newIdsOnPage++;
                                    }
                                });
                                
                                // Save after each page
                                localStorage.setItem('ao3_bookmarks', JSON.stringify([...bookmarkedWorksSet]));
                                
                                console.log('Page ' + page + '/' + totalPages + ': Found ' + pageIds.size + ' bookmarks (' + newIdsOnPage + ' new, total: ' + bookmarkedWorksSet.size + ')');
                                pageSuccess = true;
                            } else if (pageResponse.status === 429) {
                                // Rate limited - wait longer and retry
                                console.warn('Rate limited on page ' + page + '. Waiting 15 seconds before retry ' + (retryCount + 1) + '...');
                                await new Promise(function(resolve) {
                                    setTimeout(resolve, 15000);
                                });
                                retryCount++;
                            } else {
                                console.warn('Failed to fetch page ' + page + ': HTTP ' + pageResponse.status + '. Skipping.');
                                break; // Skip this page, move to next
                            }
                        } catch (error) {
                            console.warn('Error fetching page ' + page + ':', error);
                            retryCount++;
                        }
                    }
                    
                    if (!pageSuccess && retryCount >= maxRetries) {
                        console.error('Failed to fetch page ' + page + ' after ' + maxRetries + ' retries. Moving to next page.');
                    }
                }
                
                localStorage.setItem('ao3_bookmarks_last_sync', Date.now().toString());
                console.log('✅ Bookmarks extraction complete! Total bookmarks: ' + bookmarkedWorksSet.size + ' from ' + totalPages + ' pages');
                
                if (typeof alert !== 'undefined') {
                    setTimeout(function() {
                        console.log('Bookmarks extraction complete! ' + bookmarkedWorksSet.size + ' works from ' + totalPages + ' pages.');
                    }, 100);
                }
            } else {
                console.log('Only 1 page detected. Extracted ' + bookmarkedWorksSet.size + ' bookmarks.');
                localStorage.setItem('ao3_bookmarks', JSON.stringify([...bookmarkedWorksSet]));
                localStorage.setItem('ao3_bookmarks_last_sync', Date.now().toString());
            }
        } catch (error) {
            console.error('❌ Error during bookmarks extraction:', error);
        }
    }

    // Highlight works that have been bookmarked (only on search pages, NOT on bookmarks/history pages)
    function highlightBookmarkedWorks() {
        if (!bookmarksExtracted || bookmarkedWorksSet.size === 0) {
            return;
        }
        
        var currentUrl = window.location.href;
        
        // Skip if on user pages (readings, bookmarks, works, etc) - DO highlight on history page
        if (currentUrl.indexOf('/users/') !== -1 && currentUrl.indexOf('/readings') === -1) {
            return;
        }
        
        // Skip if on individual work pages
        if (currentUrl.match(/\/works\/\d+$/) || currentUrl.match(/\/works\/\d+\?/)) {
            return;
        }
        
        // Only highlight on works search/browse pages and history page
        if (currentUrl.indexOf('/works') === -1 && currentUrl.indexOf('/readings') === -1) {
            return;
        }
        
        var highlightedCount = 0;
        
        $('li.work.blurb, li.bookmark').each(function() {
            var $work = $(this);
            var workLink = $work.find('h4.heading a').first().attr('href');
            
            if (workLink && workLink.indexOf('/works/') !== -1) {
                var workIdMatch = workLink.match(/\/works\/(\d+)/);
                if (workIdMatch && workIdMatch[1]) {
                    var workId = workIdMatch[1];
                    // Only highlight if work ID exists in bookmarked set
                    if (bookmarkedWorksSet.has(workId)) {
                        // Don't override read highlighting if already highlighted
                        var hasReadHighlight = readWorksSet.has(workId) && highlight_read;
                        if (!hasReadHighlight) {
                            $work.css('background-color', bookmark_highlight_color);
                            $work.css('border-left', '3px solid #0080ff');
                            $work.css('margin-left', '-3px');
                            $work.css('padding-left', '8px');
                        }
                        highlightedCount++;
                    }
                }
            }
        });
        
        if (highlightedCount > 0) {
            console.log('Highlighted ' + highlightedCount + ' bookmarked works out of ' + bookmarkedWorksSet.size + ' total');
        }
    }

    // Display ratings and update information
    function displayRatingsAndUpdates() {
        $('li.work.blurb, li.bookmark').each(function() {
            var $work = $(this);
            var workLink = $work.find('h4.heading a').first().attr('href');
            
            if (workLink && workLink.indexOf('/works/') !== -1) {
                var workId = workLink.match(/\/works\/(\d+)/);
                if (workId && workId[1]) {
                    var workIdNum = workId[1];
                    var metadata = workMetadata[workIdNum] || {};
                    
                    // Check if this work is in read history
                    var isRead = readWorksSet.has(workIdNum);
                    
                    // Get current work stats
                    var $stats = $work.find('dl.stats');
                    var $chapters = $work.find('dd.chapters');
                    
                    // Parse chapter count from text (e.g., "42" or "42/42")
                    var chapterText = $chapters.text().trim();
                    var currentChapters = 0;
                    var totalChapters = 0;
                    
                    if (chapterText) {
                        var chapterMatch = chapterText.match(/(\d+)/);
                        if (chapterMatch) {
                            currentChapters = parseInt(chapterMatch[1]);
                        }
                        
                        var totalMatch = chapterText.match(/\/(\d+)/);
                        if (totalMatch) {
                            totalChapters = parseInt(totalMatch[1]);
                        } else {
                            totalChapters = currentChapters;
                        }
                    }
                    
                    // Get update date
                    var $updateDate = $work.find('.datetime');
                    var updateDateStr = $updateDate.attr('title') || $updateDate.text();
                    var updateDate = parseDate(updateDateStr);
                    
                    // Create rating display
                    var $ratingContainer = $work.find('.custom-rating-container');
                    if ($ratingContainer.length === 0) {
                        $ratingContainer = $('<div class="custom-rating-container"></div>');
                        $stats.prepend($ratingContainer);
                    }
                    
                    var ratingText = metadata.rating !== undefined ? metadata.rating + '/9' : 'Not rated';
                    var ratingColor = metadata.rating !== undefined ? getRatingColor(metadata.rating) : ao3_secondary;
                    $ratingContainer.html(
                        '<dt>Rating:</dt>' +
                        '<dd><span class="custom-rating" data-work-id="' + workIdNum + '" style="cursor:pointer; font-weight:bold; color:' + ratingColor + ';" title="Click to rate">' + ratingText + '</span></dd>'
                    );
                    
                    // Add click handler for rating
                    $ratingContainer.find('.custom-rating').off('click').on('click', function(e) {
                        e.preventDefault();
                        e.stopPropagation();
                        promptRating(workIdNum);
                    });
                    
                    // Display last read info for highlighted works
                    if (isRead && highlight_read) {
                        var $readInfoContainer = $work.find('.custom-read-info-container');
                        if ($readInfoContainer.length === 0) {
                            $readInfoContainer = $('<div class="custom-read-info-container"></div>');
                            $stats.prepend($readInfoContainer);
                        }
                        
                        var readInfoHTML = '';
                        
                        // Display last read date if available
                        if (metadata.lastReadDate) {
                            var lastReadDate = parseDate(metadata.lastReadDate);
                            if (lastReadDate) {
                                var formattedDate = formatReadableDate(lastReadDate);
                                readInfoHTML += '<dt style="color:' + ao3_secondary + ';">Last read:</dt>';
                                readInfoHTML += '<dd style="color:' + ao3_secondary + ';">' + formattedDate + '</dd>';
                            }
                        }
                        
                        // Display chapters remaining if we have progress info
                        if (metadata.lastReadChapters !== undefined && totalChapters > 0) {
                            var chaptersRead = metadata.lastReadChapters;
                            var chaptersRemaining = totalChapters - chaptersRead;
                            
                            if (chaptersRemaining > 0) {
                                readInfoHTML += '<dt style="color:' + ao3_secondary + ';">Chapters left:</dt>';
                                readInfoHTML += '<dd style="color:' + ao3_secondary + ';">' + chaptersRemaining + ' / ' + totalChapters + '</dd>';
                            } else if (chaptersRead >= totalChapters) {
                                readInfoHTML += '<dt style="color:' + ao3_secondary + ';">Status:</dt>';
                                readInfoHTML += '<dd style="color:green;">Complete</dd>';
                            }
                        }
                        
                        $readInfoContainer.html(readInfoHTML);
                    }
                    
                    // Check for updates
                    if (metadata.lastReadDate && metadata.lastReadChapters !== undefined && updateDate) {
                        var lastReadDate = parseDate(metadata.lastReadDate);
                        
                        // Check if work has been updated since last read
                        if (updateDate > lastReadDate) {
                            var unreadChapters = currentChapters - metadata.lastReadChapters;
                            var $updateContainer = $work.find('.custom-update-container');
                            if ($updateContainer.length === 0) {
                                $updateContainer = $('<div class="custom-update-container"></div>');
                                $stats.prepend($updateContainer);
                            }
                            
                            var updateMessage = '<dt style="font-weight:bold; color:' + ao3_accent + ';">⚠ Updated:</dt>';
                            if (unreadChapters > 0) {
                                updateMessage += '<dd style="color:' + ao3_accent + '; font-weight:bold;">+' + unreadChapters + ' new chapter' + (unreadChapters > 1 ? 's' : '') + '</dd>';
                            } else {
                                updateMessage += '<dd style="color:' + ao3_accent + '; font-weight:bold;">New update</dd>';
                            }
                            $updateContainer.html(updateMessage);
                        }
                    }
                }
            }
        });
    }
    
    // Set up click tracking for works to record when they're read
    function setupWorkClickTracking() {
        // Track clicks on work links on search/browse pages and individual work pages
        $(document).on('click', 'li.work.blurb h4.heading a, li.bookmark h4.heading a', function(e) {
            var $link = $(this);
            var workLink = $link.attr('href');
            
            if (workLink && workLink.indexOf('/works/') !== -1) {
                var workId = workLink.match(/\/works\/(\d+)/);
                if (workId && workId[1]) {
                    var workIdNum = workId[1];
                    var $work = $link.closest('li.work.blurb, li.bookmark');
                    
                    // Get current chapter info
                    var $chapters = $work.find('dd.chapters');
                    var chapterText = $chapters.text().trim();
                    var currentChapters = 0;
                    var totalChapters = 0;
                    
                    if (chapterText) {
                        var chapterMatch = chapterText.match(/(\d+)/);
                        if (chapterMatch) {
                            currentChapters = parseInt(chapterMatch[1]);
                        }
                        
                        var totalMatch = chapterText.match(/\/(\d+)/);
                        if (totalMatch) {
                            totalChapters = parseInt(totalMatch[1]);
                        } else {
                            totalChapters = currentChapters;
                        }
                    }
                    
                    // Add work to read set
                    if (!readWorksSet.has(workIdNum)) {
                        readWorksSet.add(workIdNum);
                        localStorage.setItem('ao3_read_works', JSON.stringify([...readWorksSet]));
                    }
                    
                    // Update metadata with current date and chapter count
                    if (!workMetadata[workIdNum]) {
                        workMetadata[workIdNum] = {};
                    }
                    workMetadata[workIdNum].lastReadDate = new Date().toISOString();
                    workMetadata[workIdNum].lastReadChapters = currentChapters;
                    
                    // Save metadata
                    saveMetadata();
                }
            }
        });
        
        // Also track when clicking into an individual work page (from URL)
        // This handles cases where you navigate directly to a work URL
        var currentUrl = window.location.href;
        if (currentUrl.match(/\/works\/(\d+)/)) {
            var workIdMatch = currentUrl.match(/\/works\/(\d+)/);
            if (workIdMatch && workIdMatch[1]) {
                var workIdNum = workIdMatch[1];
                
                // Add work to read set
                    if (!readWorksSet.has(workIdNum)) {
                         readWorksSet.add(workIdNum);
                    localStorage.setItem('ao3_read_works', JSON.stringify([...readWorksSet]));
                }
                
                // Update metadata
                if (!workMetadata[workIdNum]) {
                    workMetadata[workIdNum] = {};
                }
                workMetadata[workIdNum].lastReadDate = new Date().toISOString();
                
                // Try to get chapter count from the page
                var $chapters = $('dd.chapters');
                var chapterText = $chapters.text().trim();
                if (chapterText) {
                    var chapterMatch = chapterText.match(/(\d+)/);
                    if (chapterMatch) {
                        workMetadata[workIdNum].lastReadChapters = parseInt(chapterMatch[1]);
                    }
                    }
                   
                    saveMetadata();
                }
            }
    }

    // Get color for rating based on score
    function getRatingColor(rating) {
        if (rating >= 8) return '#5cb85c'; // green for excellent
        if (rating >= 6) return '#5bc0de'; // light blue for good
        if (rating >= 4) return '#f0ad4e'; // orange for fair
        if (rating >= 2) return '#d9534f'; // red for poor
        return '#999999'; // gray for very poor
    }

    // Parse date from various AO3 formats
    function parseDate(dateStr) {
        if (!dateStr) return null;
        
        // Try different date formats
        var date = new Date(dateStr);
        if (!isNaN(date.getTime())) {
            return date;
        }
        
        // Handle "Last updated: January 15, 2025" format
        dateStr = dateStr.replace(/Last updated:\s*/i, '');
        date = new Date(dateStr);
        if (!isNaN(date.getTime())) {
            return date;
        }
        
        return null;
    }
    
    // Format date in a readable relative format
    function formatReadableDate(date) {
        if (!date) return 'Unknown';
        
        var now = new Date();
        var diffMs = now.getTime() - date.getTime();
        var diffSecs = Math.floor(diffMs / 1000);
        var diffMins = Math.floor(diffSecs / 60);
        var diffHours = Math.floor(diffMins / 60);
        var diffDays = Math.floor(diffHours / 24);
        var diffWeeks = Math.floor(diffDays / 7);
        var diffMonths = Math.floor(diffDays / 30);
        var diffYears = Math.floor(diffDays / 365);
        
        if (diffSecs < 60) {
            return 'Just now';
        } else if (diffMins < 60) {
            return diffMins + ' minute' + (diffMins > 1 ? 's' : '') + ' ago';
        } else if (diffHours < 24) {
            return diffHours + ' hour' + (diffHours > 1 ? 's' : '') + ' ago';
        } else if (diffDays < 7) {
            return diffDays + ' day' + (diffDays > 1 ? 's' : '') + ' ago';
        } else if (diffWeeks < 4) {
            return diffWeeks + ' week' + (diffWeeks > 1 ? 's' : '') + ' ago';
        } else if (diffMonths < 12) {
            return diffMonths + ' month' + (diffMonths > 1 ? 's' : '') + ' ago';
        } else if (diffYears < 2) {
            return diffYears + ' year ago';
        } else {
            // For older dates, show actual date
            var months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
            return months[date.getMonth()] + ' ' + date.getDate() + ', ' + date.getFullYear();
        }
    }

    // Save metadata to localStorage
    function saveMetadata() {
        localStorage.setItem('ao3_work_metadata', JSON.stringify(workMetadata));
    }

    // Prompt user for rating
    function promptRating(workId) {
        var currentRating = workMetadata[workId] ? workMetadata[workId].rating : '';
        var rating = prompt('Rate this work (0-9):\n\n0 = Worst\n9 = Best', currentRating);
        
        if (rating !== null) {
            rating = parseInt(rating);
            if (!isNaN(rating) && rating >= 0 && rating <= 9) {
                setRating(workId, rating);
            } else if (rating !== '' && rating !== currentRating) {
                alert('Please enter a number between 0 and 9');
            }
        }
    }

    // Set rating for a work
    function setRating(workId, rating) {
        if (!workMetadata[workId]) {
            workMetadata[workId] = {};
        }
        workMetadata[workId].rating = rating;
        saveMetadata();
        displayRatingsAndUpdates();
    }
   
    // Start automatic background sync
    function startAutoSync() {
        // Only run on AO3
        if (window.location.hostname.indexOf('archiveofourown.org') === -1) {
            return;
        }
        
        // Check if we should extract from current page
        if (window.location.href.indexOf('/users/') !== -1 && 
            (window.location.href.indexOf('/readings') !== -1 || 
             window.location.href.indexOf('/works') !== -1)) {
            extractFromCurrentPage();
            readWorksExtracted = true;
            
            // If we're on a readings page, start background sync
            if (window.location.href.indexOf('/readings') !== -1 && !syncInProgress) {
                backgroundExtractHistory();
            }
        }
        
        // Set up periodic check for new works on any AO3 page
        if (syncCheckInterval === null) {
            syncCheckInterval = setInterval(function() {
                if (!syncInProgress && window.location.hostname.indexOf('archiveofourown.org') !== -1) {
                    // Check if we're on a page that might have works we haven't synced
                    checkAndExtractNewWorks();
                }
            }, 5000); // Check every 5 seconds
            
            // Check for history sync once after a delay
            setTimeout(function() {
                if (!syncInProgress && window.location.hostname.indexOf('archiveofourown.org') !== -1) {
                    checkAndStartHistorySync();
                }
            }, 10000); // Wait 10 seconds before first check
        }
    }
    
    // Check if we should navigate to history page to start background sync
    function checkAndStartHistorySync() {
        // Don't start if already syncing
        if (syncInProgress) {
            return;
        }
        
        // Check if we already synced in this session
        if (localStorage.getItem('ao3_sync_in_progress') === 'true') {
            return;
        }
        
        // Only check on main AO3 pages (not already on history page)
        var currentUrl = window.location.href;
        if (currentUrl.indexOf('/readings') === -1) {
            // Check if we have a stored history URL
            var storedHistoryUrl = localStorage.getItem('ao3_history_url');
            if (storedHistoryUrl) {
                // Check last sync time
                var lastSync = localStorage.getItem('ao3_last_sync');
                var shouldSync = true;
                
                if (lastSync) {
                    var lastSyncTime = parseInt(lastSync);
                    var now = Date.now();
                    // Only sync if it's been more than 24 hours since last sync
                    if (now - lastSyncTime < 24 * 60 * 60 * 1000) {
                        shouldSync = false;
                    }
                }
                
                if (shouldSync) {
                    console.log('Starting background history sync...');
                    localStorage.setItem('ao3_sync_in_progress', 'true');
                    // Navigate to history page in background to start sync
                    var fetchWithRetry = function(retries) {
                        if (retries >= 3) {
                            throw new Error('Failed to fetch history page after 3 retries');
                        }
                        return fetch(storedHistoryUrl + '?page=1')
                            .then(function(response) {
                                if (response.ok) {
                                    return response.text();
                                } else if (response.status === 429 && retries < 2) {
                                    console.warn('Rate limited on first page. Waiting 10 seconds...');
                                    return new Promise(function(resolve) {
                                        setTimeout(resolve, 10000);
                                    }).then(function() {
                                        return fetchWithRetry(retries + 1);
                                    });
                                }
                                throw new Error('Failed to fetch history page');
                            });
                    };
                    fetchWithRetry(0).then(function(html) {
                            var $page = $(html);
                            var ids = scrapeWorkIdsFromHTML(html);
                            ids.forEach(function(id) {
                                readWorksSet.add(id);
                            });
                            localStorage.setItem('ao3_read_works', JSON.stringify([...readWorksSet]));
                            
                            // Find total pages
                            var $pagination = $page.find('ol.pagination');
                            var totalPages = 1;
                            if ($pagination.length > 0) {
                                var $lastPageLink = $pagination.find('li:last-child a');
                                if ($lastPageLink.length > 0) {
                                    var lastPageText = $lastPageLink.text().trim();
                                    var pageMatch = lastPageText.match(/(\d+)/);
                                    if (pageMatch && pageMatch[1]) {
                                        totalPages = parseInt(pageMatch[1]);
                                    }
                                }
                            }
                            
                            // Fetch remaining pages in background
                            if (totalPages > 1) {
                                syncRemainingPages(storedHistoryUrl, totalPages);
                            } else {
                                localStorage.setItem('ao3_last_sync', Date.now().toString());
                                localStorage.removeItem('ao3_sync_in_progress');
                            }
                        })
                        .catch(function(error) {
                            console.error('Error fetching history:', error);
                            localStorage.removeItem('ao3_sync_in_progress');
                        });
                }
            }
        }
    }
    
    // Sync remaining pages in background
    async function syncRemainingPages(baseUrl, totalPages) {
        syncInProgress = true;
        
        try {
            for (var page = 2; page <= totalPages; page++) {
                var pageSuccess = false;
                var retryCount = 0;
                var maxRetries = 5;
                
                // Keep retrying this page until success or max retries
                while (!pageSuccess && retryCount < maxRetries) {
                    // Throttle: wait 2.5 seconds between requests to avoid rate limiting
                    await new Promise(function(resolve) {
                        setTimeout(resolve, 2500);
                    });
                    
                    try {
                        var pageUrl = baseUrl + '?page=' + page;
                        if (retryCount > 0) {
                            console.log('Retrying page ' + page + '/' + totalPages + ' (attempt ' + (retryCount + 1) + ')...');
                        } else {
                            console.log('Syncing page ' + page + '/' + totalPages + '...');
                        }
                        
                        var pageResponse = await fetch(pageUrl);
                        
                        if (pageResponse.ok) {
                            var pageHTML = await pageResponse.text();
                            var pageIds = scrapeWorkIdsFromHTML(pageHTML);
                            pageIds.forEach(function(id) {
                                readWorksSet.add(id);
                            });
                            localStorage.setItem('ao3_read_works', JSON.stringify([...readWorksSet]));
                            console.log('Synced page ' + page + '/' + totalPages + ' (' + readWorksSet.size + ' total works)');
                            pageSuccess = true;
                        } else if (pageResponse.status === 429) {
                            // Rate limited - wait longer and retry
                            console.warn('Rate limited on page ' + page + '. Waiting 15 seconds before retry ' + (retryCount + 1) + '...');
                            await new Promise(function(resolve) {
                                setTimeout(resolve, 15000);
                            });
                            retryCount++;
                        } else {
                            console.warn('Failed to fetch page ' + page + ': HTTP ' + pageResponse.status + '. Skipping.');
                            break; // Skip this page, move to next
                        }
                    } catch (error) {
                        console.warn('Error fetching page ' + page + ':', error);
                        retryCount++;
                    }
                }
                
                if (!pageSuccess && retryCount >= maxRetries) {
                    console.error('Failed to fetch page ' + page + ' after ' + maxRetries + ' retries. Moving to next page.');
                }
            }
            
            localStorage.setItem('ao3_last_sync', Date.now().toString());
            localStorage.removeItem('ao3_sync_in_progress');
            console.log('Background sync complete! Total works: ' + readWorksSet.size);
            
            if (highlight_read) {
                highlightReadWorks();
            }
            if (bookmarksExtracted) {
                highlightBookmarkedWorks();
            }
        } catch (error) {
            console.error('Error during background sync:', error);
            localStorage.removeItem('ao3_sync_in_progress');
        } finally {
            syncInProgress = false;
        }
    }

    // Extract new works from the current page if they're not already in our set
    function checkAndExtractNewWorks() {
        var foundIds = scrapeWorkIdsFromHTML($(document));
        var newIds = false;
        
        foundIds.forEach(function(id) {
            if (!readWorksSet.has(id)) {
                readWorksSet.add(id);
                newIds = true;
            }
        });
        
        if (newIds) {
            localStorage.setItem('ao3_read_works', JSON.stringify([...readWorksSet]));
            if (highlight_read && readWorksExtracted) {
                highlightReadWorks();
            }
            if (bookmarksExtracted) {
                highlightBookmarkedWorks();
            }
        }
    }

    // Background extraction of full history
    async function backgroundExtractHistory() {
        // Check if already syncing (but allow restart if previous sync failed)
        var wasSyncing = localStorage.getItem('ao3_sync_in_progress') === 'true';
        if (syncInProgress && wasSyncing) {
            console.log('Sync already in progress, skipping...');
            return;
        }
        
        try {
            syncInProgress = true;
            localStorage.setItem('ao3_sync_in_progress', 'true');
            
            // Get base URL from localStorage or current page
            var baseUrl = localStorage.getItem('ao3_history_url');
            if (!baseUrl) {
                baseUrl = window.location.href;
                // Remove page parameter if exists
                if (baseUrl.indexOf('?') !== -1) {
                    baseUrl = baseUrl.split('?')[0];
                }
                localStorage.setItem('ao3_history_url', baseUrl);
            }
            
            // Make sure URL is absolute
            if (baseUrl.indexOf('http') !== 0) {
                baseUrl = window.location.origin + baseUrl;
            }
            
            console.log('Starting automatic history extraction from: ' + baseUrl);
            
            // First, fetch page 1 to get total page count and extract initial works
            var firstPageResponse;
            var retries = 0;
            while (retries < 3) {
                firstPageResponse = await fetch(baseUrl + '?page=1');
                if (firstPageResponse.ok) {
                    break;
                } else if (firstPageResponse.status === 429 && retries < 2) {
                    console.warn('Rate limited on first page. Waiting 10 seconds...');
                    await new Promise(function(resolve) {
                        setTimeout(resolve, 10000);
                    });
                    retries++;
                } else {
                    throw new Error('Failed to fetch first page: ' + firstPageResponse.status);
                }
            }
            
            var firstPageHTML = await firstPageResponse.text();
            var $firstPage = $(firstPageHTML);
            
            // Extract work IDs from first page
            var firstPageIds = scrapeWorkIdsFromHTML(firstPageHTML);
            firstPageIds.forEach(function(id) {
                readWorksSet.add(id);
            });
            console.log('Page 1: Extracted ' + firstPageIds.size + ' works (total: ' + readWorksSet.size + ')');
            
            // Find total pages from pagination - try multiple methods
            var totalPages = 1;
            var $pagination = $firstPage.find('ol.pagination');
            
            if ($pagination.length > 0) {
                // Method 1: Last pagination link
                var $lastPageLink = $pagination.find('li:last-child a');
                if ($lastPageLink.length > 0) {
                    var lastPageText = $lastPageLink.text().trim();
                    var pageMatch = lastPageText.match(/(\d+)/);
                    if (pageMatch && pageMatch[1]) {
                        totalPages = parseInt(pageMatch[1]);
                    }
                }
                
                // Method 2: If no last link, try finding highest page number
                if (totalPages === 1) {
                    $pagination.find('li a').each(function() {
                        var linkText = $(this).text().trim();
                        var match = linkText.match(/^(\d+)$/);
                        if (match && match[1]) {
                            var pageNum = parseInt(match[1]);
                            if (pageNum > totalPages) {
                                totalPages = pageNum;
                            }
                        }
                    });
                }
            }
            
            // If still 1 page, also check current page pagination (in case first page fetch was different)
            if (totalPages === 1 && window.location.href.indexOf('/readings') !== -1) {
                var $currentPagination = $('ol.pagination');
                if ($currentPagination.length > 0) {
                    var $lastLink = $currentPagination.find('li:last-child a');
                    if ($lastLink.length > 0) {
                        var lastText = $lastLink.text().trim();
                        var match = lastText.match(/(\d+)/);
                        if (match && match[1]) {
                            totalPages = parseInt(match[1]);
                        }
                    }
                }
            }
            
            if (totalPages > 1) {
                console.log('Detected ' + totalPages + ' total pages. Starting background sync...');
                
                // Save progress after first page
                localStorage.setItem('ao3_read_works', JSON.stringify([...readWorksSet]));
                
                // Fetch all remaining pages (2 to totalPages)
                for (var page = 2; page <= totalPages; page++) {
                    var pageSuccess = false;
                    var retryCount = 0;
                    var maxRetries = 5;
                    
                    // Keep retrying this page until success or max retries
                    while (!pageSuccess && retryCount < maxRetries) {
                        // Throttle: wait 2.5 seconds between requests to avoid rate limiting
                        await new Promise(function(resolve) {
                            setTimeout(resolve, 2500);
                        });
                        
                        try {
                            var pageUrl = baseUrl + '?page=' + page;
                            if (retryCount > 0) {
                                console.log('Retrying page ' + page + '/' + totalPages + ' (attempt ' + (retryCount + 1) + ')...');
                            } else {
                                console.log('Fetching page ' + page + '/' + totalPages + '...');
                            }
                            
                            var pageResponse = await fetch(pageUrl);
                            
                            if (pageResponse.ok) {
                                var pageHTML = await pageResponse.text();
                                var pageIds = scrapeWorkIdsFromHTML(pageHTML);
                                var newIdsOnPage = 0;
                                
                                pageIds.forEach(function(id) {
                                    if (!readWorksSet.has(id)) {
                                        readWorksSet.add(id);
                                        newIdsOnPage++;
                                    }
                                });
                                
                                // Save after each page to preserve progress
                                localStorage.setItem('ao3_read_works', JSON.stringify([...readWorksSet]));
                                
                                console.log('Page ' + page + '/' + totalPages + ': Found ' + pageIds.size + ' works (' + newIdsOnPage + ' new, total: ' + readWorksSet.size + ')');
                                pageSuccess = true;
                            } else if (pageResponse.status === 429) {
                                // Rate limited - wait longer and retry
                                console.warn('Rate limited on page ' + page + '. Waiting 15 seconds before retry ' + (retryCount + 1) + '...');
                                await new Promise(function(resolve) {
                                    setTimeout(resolve, 15000);
                                });
                                retryCount++;
                            } else {
                                console.warn('Failed to fetch page ' + page + ': HTTP ' + pageResponse.status + '. Skipping.');
                                break; // Skip this page, move to next
                            }
                        } catch (error) {
                            console.warn('Error fetching page ' + page + ':', error);
                            retryCount++;
                        }
                    }
                    
                    if (!pageSuccess && retryCount >= maxRetries) {
                        console.error('Failed to fetch page ' + page + ' after ' + maxRetries + ' retries. Moving to next page.');
                    }
                }
                
                localStorage.setItem('ao3_last_sync', Date.now().toString());
                localStorage.removeItem('ao3_sync_in_progress');
                console.log('✅ Background sync complete! Total works extracted: ' + readWorksSet.size + ' from ' + totalPages + ' pages');
                
                // Show notification if possible
                if (typeof alert !== 'undefined') {
                    setTimeout(function() {
                        alert('History extraction complete!\n\nExtracted ' + readWorksSet.size + ' works from ' + totalPages + ' pages.\n\nYou can now browse search pages to see highlighted works.');
                    }, 100);
                }
                
                if (highlight_read) {
                    highlightReadWorks();
                }
                if (bookmarksExtracted) {
                    highlightBookmarkedWorks();
                }
            } else {
                // Single page or couldn't detect pagination
                console.log('Only 1 page detected or pagination not found. Extracted ' + readWorksSet.size + ' works.');
                localStorage.setItem('ao3_read_works', JSON.stringify([...readWorksSet]));
                localStorage.setItem('ao3_last_sync', Date.now().toString());
                localStorage.removeItem('ao3_sync_in_progress');
            }
        } catch (error) {
            console.error('❌ Error during background sync:', error);
            localStorage.removeItem('ao3_sync_in_progress');
            alert('Error during history extraction: ' + error.message + '\n\nSome works may have been saved. Check console for details.');
        } finally {
            syncInProgress = false;
        }
    }

})(window.jQuery);
// AO3 theme colors
var ao3_bg = '#f8f8f8';
var ao3_text = '#333333';
var ao3_accent = '#900';
var ao3_border = '#d0d0d0';
var ao3_secondary = '#666';
// ~~ END OF SETTINGS ~~ //

// Global storage
var readWorksSet = new Set();
var workMetadata = {};
var syncInProgress = false;

// *** SCOPE FIX ***
// These are now global-like (within the script) so all functions can see them
var countable = false;
var sortable = false;
var stats_page = false;


(function ($) {
    console.log('%c[AO3 RATER]: Script loading...', 'color: #008080; font-weight: bold;');

    Promise.all([
        GM_getValue('alwayscountlocal', 'yes'),
        GM_getValue('alwayssortlocal', 'no'),
        GM_getValue('hidehitcountlocal', 'yes'),
        GM_getValue('highlightreadlocal', 'yes'),
        GM_getValue('ao3_read_works', '[]'),
        // Removed kudosed_works
        GM_getValue('ao3_work_metadata', '{}')
    ]).then(function(values) {

        console.log('[AO3 RATER]: START: All settings and data loaded from GM_storage.');

        always_count = (values[0] == 'yes');
        always_sort = (values[1] == 'yes');
        hide_hitcount = (values[2] == 'yes');
        highlight_read = (values[3] == 'yes');

        try {
            readWorksSet = new Set(JSON.parse(values[4]));
            console.log(`[AO3 RATER]: Loaded ${readWorksSet.size} Read Work IDs.`);
        } catch (e) {
            console.error('[AO3 RATER]: Failed to parse stored read works!', e);
            readWorksSet = new Set();
        }

        try {
            workMetadata = JSON.parse(values[5]); // Index is now 5
            console.log(`[AO3 RATER]: Loaded Metadata for ${Object.keys(workMetadata).length} works.`);
        } catch (e) {
            console.error('[AO3 RATER]: Failed to parse stored work metadata!', e);
            workMetadata = {};
        }

        runMainScript();
    });

    function runMainScript() {
        console.log('[AO3 RATER]: Running main script functions...');
        // *** SCOPE FIX ***
        // The 'var' declarations are removed from here

        checkCountable();
        checkAndStoreHistoryUrl();

        if (always_count) {
            countRatio();
            if (always_sort) {
                sortByRatio();
            }
        }

        displayRatingsAndUpdates();
        setupWorkPageTracking(); // For auto-saving progress when visiting a work page
        console.log('[AO3 RATER]: Main script functions complete.');
    }


    // check if it's a list of works/bookmarks/statistics, or header on work page
    function checkCountable() {
        var found_stats = $('dl.stats');
        if (found_stats.length) {
            if (found_stats.closest('li').is('.work') || found_stats.closest('li').is('.bookmark')) {
                countable = true;
                sortable = true;
                addRatioMenu();
            } else if (found_stats.parents('.statistics').length) {
                countable = true;
                sortable = true;
                stats_page = true; // This is now set correctly in the global scope
                addRatioMenu();
            } else if (found_stats.parents('dl.work').length) {
                countable = true;
                addRatioMenu();
            }
        }
    }

    // --- attach the menu ---
    function addRatioMenu() {
        console.log('[AO3 RATER]: Adding "Ratings & Stats" menu to header.');
        var header_menu = $('ul.primary.navigation.actions');
        var ratio_menu = $('<li class="dropdown"></li>').html('<a>Ratings & Stats</a>');
        header_menu.find('li.search').before(ratio_menu);
        var drop_menu = $('<ul class="menu dropdown-menu"></li>');
        ratio_menu.append(drop_menu);

        // --- Standard Buttons ---
        var button_count = $('<li></li>').html('<a>Count on this page</a>');
        button_count.click(function () { countRatio(); });
        var button_sort = $('<li></li>').html('<a>Sort by kudos/hits ratio</a>');
        button_sort.click(function () { sortByRatio(); });
        var button_sort_rating = $('<li></li>').html('<a>Sort by rating</a>');
        button_sort_rating.click(function () { sortByRating(); });
        var button_settings = $('<li></li>').html('<a style="padding: 0.5em 0.5em 0.25em; text-align: center; font-weight: bold; border-bottom: 1px solid ' + ao3_border + '; display: block; color: ' + ao3_text + ';">Settings</a>');

        drop_menu.append(button_count);
        if (sortable) {
            drop_menu.append(button_sort);
            drop_menu.append(button_sort_rating);
        }
        drop_menu.append(button_settings);

        // --- Toggle Buttons ---
        var button_count_toggle = $(always_count ? '<li class="count-yes"><a>Count automatically: YES</a></li>' : '<li class="count-no"><a>Count automatically: NO</a></li>');
        drop_menu.on('click', 'li.count-yes, li.count-no', function () {
            always_count = !always_count;
            GM_setValue('alwayscountlocal', always_count ? 'yes' : 'no');
            $(this).find('a').text('Count automatically: ' + (always_count ? 'YES' : 'NO'));
            $(this).toggleClass('count-yes count-no');
        });
        drop_menu.append(button_count_toggle);

        var button_sort_toggle = $(always_sort ? '<li class="sort-yes"><a>Sort automatically: YES</a></li>' : '<li class="sort-no"><a>Sort automatically: NO</a></li>');
        drop_menu.on('click', 'li.sort-yes, li.sort-no', function () {
            always_sort = !always_sort;
            GM_setValue('alwayssortlocal', always_sort ? 'yes' : 'no');
            $(this).find('a').text('Sort automatically: ' + (always_sort ? 'YES' : 'NO'));
            $(this).toggleClass('sort-yes sort-no');
        });
        drop_menu.append(button_sort_toggle);

        var button_hide_toggle = $(hide_hitcount ? '<li class="hide-yes"><a>Hide hitcount: YES</a></li>' : '<li class="hide-no"><a>Hide hitcount: NO</a></li>');
        drop_menu.on('click', 'li.hide-yes, li.hide-no', function () {
            hide_hitcount = !hide_hitcount;
            GM_setValue('hidehitcountlocal', hide_hitcount ? 'yes' : 'no');
            $('.stats .hits').css('display', hide_hitcount ? 'none' : '');
            $(this).find('a').text('Hide hitcount: ' + (hide_hitcount ? 'YES' : 'NO'));
            $(this).toggleClass('hide-yes hide-no');
        });
        drop_menu.append(button_hide_toggle);

        var button_highlight_toggle = $(highlight_read ? '<li class="highlight-yes"><a>Highlight read: YES</a></li>' : '<li class="highlight-no"><a>Highlight read: NO</a></li>');
        drop_menu.on('click', 'li.highlight-yes, li.highlight-no', function () {
            highlight_read = !highlight_read;
            GM_setValue('highlightreadlocal', highlight_read ? 'yes' : 'no');
            $(this).find('a').text('Highlight read: ' + (highlight_read ? 'YES' : 'NO'));
            $(this).toggleClass('highlight-yes highlight-no');
            displayRatingsAndUpdates(); // Refresh highlights
        });
        drop_menu.append(button_highlight_toggle);

        // --- Sync Buttons ---
        var button_refresh = $('<li class="refresh-reads"></li>').html('<a style="color: ' + ao3_accent + ';">🔄 Clear All Local Data</a>');
        drop_menu.on('click', 'li.refresh-reads', function () {
            if (confirm('This will delete all your saved ratings and read history from this script. Are you sure?')) {
                console.log('%c[AO3 RATER]: User cleared all local data.', 'color: red; font-weight: bold;');
                GM_deleteValue('ao3_read_works');
                GM_deleteValue('ao3_work_metadata');
                GM_deleteValue('ao3_history_url');
                readWorksSet.clear();
                workMetadata = {};
                alert('All local data cleared. Please refresh the page.');
            }
        });
        drop_menu.append(button_refresh);

        var button_sync_full = $('<li class="full-history-sync"></li>').html('<a style="color: ' + ao3_accent + '; font-weight: bold;">🔄 Sync Full History (Read)</a>');
        drop_menu.on('click', 'li.full-history-sync', function () {
            syncFullHistory(this);
        });
        drop_menu.append(button_sync_full);

        // Removed Kudos Sync Button
    }

    // --- Helper function to fetch a page using GM_xmlhttpRequest ---
    function fetchPage(url) {
        return new Promise((resolve, reject) => {
            GM_xmlhttpRequest({
                method: "GET",
                url: url,
                onload: function(response) {
                    if (response.status >= 200 && response.status < 400) {
                        resolve(response.responseText);
                    } else {
                        console.error(`[AO3 RATER]: Failed to fetch page: ${url} (Status: ${response.status})`);
                        reject(new Error('Failed to fetch page: ' + response.status));
                    }
                },
                onerror: function(error) {
                    console.error(`[AO3 RATER]: Network error fetching ${url}:`, error);
                    reject(new Error('Network error: ' + error));
                }
            });
        });
    }

    // --- Your specific scraper for fic blurbs ---
    function scrapeWorkIdsFromHTML(htmlToScrape) {
        var workIds = new Set();
        var $html = $(htmlToScrape);
        $html.find('li.work.blurb h4.heading a, li.bookmark.blurb h4.heading a').each(function() {
            var workLink = $(this).attr('href');
            if (workLink && workLink.indexOf('/works/') !== -1) {
                var workIdMatch = workLink.match(/\/works\/(\d+)/);
                if (workIdMatch && workIdMatch[1]) {
                    var workId = workIdMatch[1];
                    if (/^\d+$/.test(workId)) {
                        workIds.add(workId);
                    }
                }
            }
        });
        return workIds;
    }

    // --- Full History Sync Function ---
    async function syncFullHistory(buttonElement) {
        if (syncInProgress) {
            alert('A sync is already in progress. Please wait.');
            return;
        }
        syncInProgress = true;
        console.log(`%c[SYNC History]: Starting...`, 'color: blue; font-weight: bold;');

        var urlKey = 'ao3_history_url';
        var dataKey = 'ao3_read_works';
        var syncType = 'History';
        var userLink = $('a[href^="/users/"][href*="/readings"]').first();

        try {
            var baseUrl = await GM_getValue(urlKey);

            if (!baseUrl) {
                 if (userLink.length > 0) {
                     baseUrl = userLink.attr('href').split('?')[0];
                     if (baseUrl.indexOf('http') !== 0) {
                         baseUrl = window.location.origin + baseUrl;
                     }
                     await GM_setValue(urlKey, baseUrl);
                 } else {
                     alert(`Could not find your "${syncType}" URL. Please navigate to your "My ${syncType}" page once to teach the script where it is, then try again.`);
                     syncInProgress = false;
                     return;
                 }
            }

            if (baseUrl.indexOf('http') !== 0) {
                baseUrl = window.location.origin + baseUrl;
            }

            console.log(`[SYNC ${syncType}]: Found base URL:`, baseUrl);

            $(buttonElement).find('a').text('Syncing... Fetching page 1...');

            var firstPageHTML = await fetchPage(baseUrl);
            var $firstPage = $(firstPageHTML);

            var dataSet = readWorksSet; // We only care about the read set
            var originalSize = dataSet.size;

            var firstPageIds = scrapeWorkIdsFromHTML(firstPageHTML);
            firstPageIds.forEach(id => dataSet.add(id));

            // --- *** NEW PAGINATION LOGIC *** ---
            var totalPages = 1;
            var $pagination = $firstPage.find('ol.pagination li a');
            if ($pagination.length > 0) {
                $pagination.each(function() {
                    var pageNum = parseInt($(this).text());
                    if (!isNaN(pageNum) && pageNum > totalPages) {
                        totalPages = pageNum; // Find the highest number
                    }
                });
            }
            // --- *** END NEW LOGIC *** ---

            console.log(`[SYNC ${syncType}]: Found ${totalPages} total pages.`);

            alert(`Starting full ${syncType} sync for ${totalPages} pages. This will take several minutes. Please leave this tab open.`);

            for (var page = 2; page <= totalPages; page++) {
                await new Promise(resolve => setTimeout(resolve, 1500)); // 1.5 second throttle

                var statusText = `Syncing page ${page}/${totalPages}...`;
                $(buttonElement).find('a').text(statusText);
                console.log(`[SYNC ${syncType}]: ${statusText}`);

                var pageUrl = baseUrl + '?page=' + page;

                try {
                    var pageHTML = await fetchPage(pageUrl);
                    var pageIds = scrapeWorkIdsFromHTML(pageHTML);
                    pageIds.forEach(id => dataSet.add(id));

                } catch (error) {
                    console.warn(`[SYNC ${syncType}]: Error fetching page ${page}:`, error);
                }
            }

            var newIds = dataSet.size - originalSize;
            await GM_setValue(dataKey, JSON.stringify([...dataSet]));

            $(buttonElement).find('a').text(`🔄 Sync Full ${syncType}`);
            console.log(`%c[SYNC ${syncType}]: COMPLETE. Found ${newIds} new IDs. Total saved: ${dataSet.size}`, 'color: green; font-weight: bold;');
            alert(`Full ${syncType} sync complete! ${dataSet.size} works have been saved. Please refresh the page to see highlights.`);

            displayRatingsAndUpdates(); // Refresh highlights

        } catch (error) {
            console.error(`%c[SYNC ${syncType}]: FAILED:`, 'color: red; font-weight: bold;', error);
            $(buttonElement).find('a').text(`🔄 Sync Full ${syncType}`);
            alert(`Error during ${syncType} sync: ${error.message}. Some works may have been saved. Please try again.`);
        } finally {
            syncInProgress = false;
        }
    }

    // --- On history page, save the URL ---
    function checkAndStoreHistoryUrl() {
        var currentUrl = window.location.href;
        if (currentUrl.indexOf('/users/') !== -1) {
            if (currentUrl.indexOf('/readings') !== -1) {
                console.log('[AO3 RATER]: On History page. Storing URL.');
                GM_setValue('ao3_history_url', currentUrl.split('?')[0]);
            }
            // Removed Kudos check
        }
    }

    // --- Highlight, Track, and Add Buttons ---
    function displayRatingsAndUpdates() {
        console.log('[AO3 RATER]: Running displayRatingsAndUpdates()...');
        var highlightedRead = 0;

        $('li.work.blurb, li.bookmark').each(function() {
            var $work = $(this);
            var workLink = $work.find('h4.heading a').first().attr('href');

            if (!workLink || workLink.indexOf('/works/') === -1) return;
            var workIdMatch = workLink.match(/\/works\/(\d+)/);
            if (!workIdMatch || !workIdMatch[1]) return;

            var workId = workIdMatch[1];
            var metadata = workMetadata[workId] || {};
            var isRead = readWorksSet.has(workId);

            var $stats = $work.find('dl.stats');

            // --- 1. Highlighting Logic ---
            // Clear old highlights first
            $work.css('background-color', '').css('border-left', '').css('margin-left', '').css('padding-left', '');

            if (highlight_read && (isRead || metadata.lastReadChapters !== undefined)) {
                $work.css('background-color', read_highlight_color);
                $work.css('border-left', '3px solid ' + ao3_accent);
                $work.css('margin-left', '-3px');
                $work.css('padding-left', '8px');
                highlightedRead++;
            }
            // Removed 'else if (isKudosed)'

            // --- 2. Inject UI ---
            var $uiContainer = $work.find('.custom-ui-container');
            if ($uiContainer.length === 0) {
                $uiContainer = $('<div class="custom-ui-container" style="margin-top: 5px; display: flex; gap: 10px; align-items: center;"></div>');
                $stats.before($uiContainer);
            }

            var ratingText = metadata.rating !== undefined ? `Rating: ${metadata.rating}/9` : 'Rate 0-9';
            var ratingColor = metadata.rating !== undefined ? getRatingColor(metadata.rating) : ao3_secondary;
            var buttonStyle = 'cursor:pointer; color:' + ao3_accent + '; text-decoration:none; border:1px solid ' + ao3_border + '; padding:2px 6px; border-radius:3px; display:inline-block; font-size:0.9em;';
            var uiHTML = `
                <span class="custom-rate-button" data-work-id="${workId}" style="${buttonStyle} color:${ratingColor};" title="Click to rate this fic">${ratingText}</span>
                <span class="custom-mark-read-button" data-work-id="${workId}" style="${buttonStyle}" title="Mark all current chapters as read">✓ Mark as Read</span>
            `;
            $uiContainer.html(uiHTML);

            // --- 3. Update Notification Logic ---
            var $updateContainer = $work.find('.custom-update-container');

            if (metadata.lastReadChapters !== undefined) {
                if ($updateContainer.length === 0) {
                    $updateContainer = $('<div class="custom-update-container" style="margin-top: 5px;"></div>');
                    $stats.prepend($updateContainer);
                }

                var $chapters = $work.find('dd.chapters');
                var chapterText = $chapters.text().trim();
                var currentChapters = 0;
                var totalChapters = 0;

                if (chapterText) {
                    var chapterMatch = chapterText.match(/(\d+)/);
                    if (chapterMatch) currentChapters = parseInt(chapterMatch[1]);
                    var totalMatch = chapterText.match(/\/(\d+)/);
                    totalChapters = totalMatch ? parseInt(totalMatch[1]) : currentChapters;
                }

                var $updateDate = $work.find('.datetime');
                var updateDate = parseDate($updateDate.attr('title') || $updateDate.text());
                var lastReadDate = parseDate(metadata.lastReadDate);

                var updateMessage = '';

                if (lastReadDate && updateDate && updateDate > lastReadDate && currentChapters > metadata.lastReadChapters) {
                    var unreadChapters = currentChapters - metadata.lastReadChapters;
                    updateMessage += `
                        <dt style="font-weight:bold; color:${ao3_accent};">⚠ Updated:</dt>
                        <dd style="color:${ao3_accent}; font-weight:bold;">+${unreadChapters} new chapter${unreadChapters > 1 ? 's' : ''}</dd>
                    `;
                }

                var chaptersRemaining = totalChapters > 0 ? totalChapters - metadata.lastReadChapters : 0;
                if (chaptersRemaining > 0 && currentChapters > metadata.lastReadChapters) {
                     updateMessage += `
                        <dt style="color:${ao3_secondary};">Chapters left:</dt>
                        <dd style="color:${ao3_secondary};">${chaptersRemaining} / ${totalChapters}</dd>
                    `;
                } else if (chaptersRemaining <= 0 && currentChapters >= metadata.lastReadChapters) {
                     updateMessage += `
                        <dt style="color:${ao3_secondary};">Status:</dt>
                        <dd style="color:green;">Up to date</dd>
                    `;
                }

                if (lastReadDate) {
                     updateMessage += `
                        <dt style="color:${ao3_secondary};">Last read:</dt>
                        <dd style="color:${ao3_secondary};">${formatReadableDate(lastReadDate)}</dd>
                    `;
                }
                $updateContainer.html(updateMessage);
            } else {
                 if ($updateContainer.length > 0) $updateContainer.empty();
            }
        });

        console.log(`[AO3 RATER]: Display complete. Highlighted ${highlightedRead} READ works.`);

        // --- 4. Add Global Click Handlers for UI ---
        $(document).off('click.rater').on('click.rater', '.custom-rate-button', function(e) {
            e.preventDefault();
            e.stopPropagation();
            var workId = $(this).data('work-id');
            console.log(`[AO3 RATER]: User clicked RATE for Work ID: ${workId}`);
            promptRating(workId);
        });

        $(document).off('click.marker').on('click.marker', '.custom-mark-read-button', function(e) {
            e.preventDefault();
            e.stopPropagation();
            var workId = $(this).data('work-id');
            console.log(`%c[AO3 RATER]: User clicked MARK AS READ for Work ID: ${workId}`, 'color: orange;');
            var $work = $(this).closest('li.work.blurb, li.bookmark');
            markAsRead(workId, $work);
        });
    }

    // --- Rating Functions ---
    function promptRating(workId) {
        var currentRating = workMetadata[workId] ? workMetadata[workId].rating : '';
        var rating = prompt('Rate this work (0-9):\n\n0 = Worst\n9 = Best', currentRating);

        if (rating !== null) {
            rating = parseInt(rating);
            if (!isNaN(rating) && rating >= 0 && rating <= 9) {
                if (!workMetadata[workId]) {
                    workMetadata[workId] = {};
                }
                workMetadata[workId].rating = rating;
                console.log(`[AO3 RATER]: Saved rating ${rating} for Work ID: ${workId}`);
                saveMetadata();
                displayRatingsAndUpdates();
            } else if (rating !== '' && rating !== currentRating) {
                alert('Please enter a number between 0 and 9');
            }
        }
    }

    function getRatingColor(rating) {
        if (rating >= 8) return '#5cb85c';
        if (rating >= 6) return '#5bc0de';
        if (rating >= 4) return '#f0ad4e';
        if (rating >= 2) return '#d9534f';
        return '#999999';
    }

    // --- Mark as Read Function ---
    function markAsRead(workId, $work) {
        if (!workMetadata[workId]) {
            workMetadata[workId] = {};
        }

        var $chapters = $work.find('dd.chapters');
        var chapterText = $chapters.text().trim();
        var currentChapters = 0;
        if (chapterText) {
            var chapterMatch = chapterText.match(/(\d+)/);
            if (chapterMatch) {
                currentChapters = parseInt(chapterMatch[1]);
            }
        }

        workMetadata[workId].lastReadDate = new Date().toISOString();
        workMetadata[workId].lastReadChapters = currentChapters;

        console.log(`[AO3 RATER]: Marking Work ID ${workId} as read up to chapter ${currentChapters}.`);

        if (!readWorksSet.has(workId)) {
            readWorksSet.add(workId);
            GM_setValue('ao3_read_works', JSON.stringify([...readWorksSet]));
            console.log(`[AO3 RATER]: Added Work ID ${workId} to main 'read' list.`);
        }

        saveMetadata();
        displayRatingsAndUpdates();
    }

    // --- Utility Functions ---
    function saveMetadata() {
        console.log('[AO3 RATER]: Saving workMetadata to GM_storage...');
        GM_setValue('ao3_work_metadata', JSON.stringify(workMetadata));
    }

    function parseDate(dateStr) {
        if (!dateStr) return null;
        dateStr = dateStr.replace(/Last updated:\s*/i, '');
        var match = dateStr.match(/(\d{1,2})\s(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s(\d{4})/);
        if (match) {
            return new Date(match[2] + ' ' + match[1] + ', ' + match[3]);
        }
        match = dateStr.match(/(\d{4})-(\d{2})-(\d{2})/);
        if (match) {
            return new Date(dateStr);
        }
        if (dateStr.indexOf('T') > -1) {
             var isoDate = new Date(dateStr);
             if (!isNaN(isoDate.getTime())) return isoDate;
        }
        var date = new Date(dateStr);
        if (!isNaN(date.getTime())) return date;
        return null;
    }

    function formatReadableDate(date) {
        if (!date) return 'Unknown';
        var now = new Date();
        var diffMs = now.getTime() - date.getTime();
        var diffSecs = Math.floor(diffMs / 1000);
        var diffMins = Math.floor(diffSecs / 60);
        var diffHours = Math.floor(diffMins / 60);
        var diffDays = Math.floor(diffHours / 24);

        if (diffSecs < 60) { return 'Just now'; }
        else if (diffMins < 60) { return diffMins + ' min' + (diffMins > 1 ? 's' : '') + ' ago'; }
        else if (diffHours < 24) { return diffHours + ' hour' + (diffHours > 1 ? 's' : '') + ' ago'; }
        else if (diffDays < 365) { return diffDays + ' day' + (diffDays > 1 ? 's' : '') + ' ago'; }
        else {
            var months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
            return months[date.getMonth()] + ' ' + date.getDate() + ', ' + date.getFullYear();
        }
    }

    // --- Auto-save read progress on a work page ---
    function setupWorkPageTracking() {
        // Removed kudos tracking

        // Auto-save read progress when on a work page
        var currentUrl = window.location.href;
        if (currentUrl.match(/\/works\/(\d+)/)) {
            var workIdMatch = currentUrl.match(/\/works\/(\d+)/);
            if (workIdMatch && workIdMatch[1]) {
                var workIdNum = workIdMatch[1];

                if (!readWorksSet.has(workIdNum)) {
                    readWorksSet.add(workIdNum);
                    GM_setValue('ao3_read_works', JSON.stringify([...readWorksSet]));
                    console.log(`%c[AO3 RATER]: Work page loaded. Added Work ID ${workIdNum} to read list.`, 'color: orange;');
                }

                if (!workMetadata[workIdNum]) {
                    workMetadata[workIdNum] = {};
                }
                workMetadata[workIdNum].lastReadDate = new Date().toISOString();

                var $chapterTitle = $('h3.title').text().match(/Chapter (\d+)/);
                var $chapterDropdown = $('#selected_id option[selected="selected"]');
                var currentChapter = 1;

                if ($chapterTitle && $chapterTitle[1]) {
                    currentChapter = parseInt($chapterTitle[1]);
                } else if ($chapterDropdown.length > 0) {
                    currentChapter = parseInt($chapterDropdown.val());
                } else {
                    var $chapters = $('dd.chapters');
                    var chapterText = $chapters.text().trim();
                    if (chapterText === '1/1') {
                         currentChapter = 1;
                    }
                }

                var oldChapters = workMetadata[workIdNum].lastReadChapters || 0;
                if (currentChapter >= oldChapters) {
                    workMetadata[workIdNum].lastReadChapters = currentChapter;
                    console.log(`%c[AO3 RATER]: Work page loaded. Updated last-read chapter for ${workIdNum} to ${currentChapter}.`, 'color: orange;');
                }

                saveMetadata();
            }
        }
    }

    // --- Functions from the original script ---
    function countRatio() {
        if (countable) {
            $('dl.stats').each(function () {
                var $hits = $(this).find('dd.hits');
                var $kudos = $(this).find('dd.kudos');
                if ($kudos.length && $hits.length && $hits.text() !== '0') {
                    var hits_count = parseInt($hits.text().replace(/\D/g, ''));
                    var kudos_count = parseInt($kudos.text().replace(/\D/g, ''));
                    if (hits_count > 0) {
                        var percents = 100 * kudos_count / hits_count;
                        var percents_print = percents.toFixed(1).replace('.', ',');
                        var ratio_label = $('<dt class="kudoshits"></dt>').text('Kudos/Hits:');
                        var ratio_value = $('<dd class="kudoshits"></dd>').text(percents_print + '%').css('font-weight', 'bold');
                        $hits.after(ratio_label, ratio_value);

                        if (colourbg) {
                            if (percents >= lvl2) {
                                ratio_value.css('background-color', ratio_green);
                            } else if (percents >= lvl1) {
                                ratio_value.css('background-color', ratio_yellow);
                            } else {
                                ratio_value.css('background-color', ratio_red);
                            }
                        }
                        if (hide_hitcount && !stats_page) { // stats_page is now correctly in scope
                            $(this).find('.hits').css('display', 'none');
                        }
                        $(this).closest('li').attr('kudospercent', percents);
                    }
                } else {
                    $(this).closest('li').attr('kudospercent', 0);
                }
            });
        }
    }

    function sortByRatio(ascending) {
        if (sortable) {
            var sortable_lists = $('dl.stats').closest('li').parent();
            sortable_lists.each(function () {
                var list_elements = $(this).children('li');
                list_elements.sort(function (a, b) {
                    return parseFloat(b.getAttribute('kudospercent')) - parseFloat(a.getAttribute('kudospercent'));
                });
                if (ascending) {
                    $(list_elements.get().reverse()).detach().appendTo($(this));
                } else {
                    list_elements.detach().appendTo($(this));
                }
            });
        }
    }

    function sortByRating(ascending) {
        if (sortable) {
            var sortable_lists = $('dl.stats').closest('li').parent();
            sortable_lists.each(function () {
                var list_elements = $(this).children('li');
                list_elements.each(function() {
                    var $element = $(this);
                    var workLink = $element.find('h4.heading a').first().attr('href');
                    if (workLink && workLink.indexOf('/works/') !== -1) {
                        var workIdMatch = workLink.match(/\/works\/(\d+)/);
                        if (workIdMatch && workIdMatch[1]) {
                            var metadata = workMetadata[workIdMatch[1]] || {};
                            var rating = metadata.rating !== undefined ? metadata.rating : -1;
                            $element.attr('custom-rating', rating);
                        }
                    }
                });
                list_elements.sort(function (a, b) {
                    return parseFloat(b.getAttribute('custom-rating')) - parseFloat(a.getAttribute('custom-rating'));
                });
                if (ascending) {
                    $(list_elements.get().reverse()).detach().appendTo($(this));
                } else {
                    list_elements.detach().appendTo($(this));
                }
            });
        }
    }

})(window.jQuery);
