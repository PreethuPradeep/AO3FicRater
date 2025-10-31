// ==UserScript==
// @name        AO3: Kudos/hits ratio & ratings
// @description Replace hitcount with kudos/hits percentage. Sort works by ratio or ratings. Highlight fics you've read, show updates, and track your ratings.
// @namespace	https://greasyfork.org/scripts/3144-ao3-kudos-hits-ratio
// @author	Min
// @version	1.9.1
// @history	1.9.1 - removed mark read button, changed highlight to red with 0.1 opacity, only on search pages
// @history	1.9 - fixed mark read button, added automatic background sync of full reading history
// @history	1.8 - improved UI with AO3 theme colors and better styling
// @history	1.7 - added rating system, update tracking, and sorting by ratings
// @history	1.6 - added read works highlighting from history
// @history	1.4 - always show hits on stats page, require jquery (for firefox)
// @history	1.3 - works for statistics, option to show hitcount
// @history	1.2 - makes use of new stats classes
// @grant       none
// @require     https://ajax.googleapis.com/ajax/libs/jquery/1.9.0/jquery.min.js
// @include     http://archiveofourown.org/*
// @include     https://archiveofourown.org/*
// @downloadURL https://update.greasyfork.org/scripts/3144/AO3%3A%20Kudoshits%20ratio.user.js
// @updateURL https://update.greasyfork.org/scripts/3144/AO3%3A%20Kudoshits%20ratio.meta.js
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

    // Display ratings if enabled
    displayRatingsAndUpdates();




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
                    hits_value.after('\n', ratio_label, '\n', ratio_value);

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
            button_highlight_no.replaceWith(button_highlight_yes);
        });

        // create button - refresh read works
        var button_refresh = $('<li class="refresh-reads"></li>').html('<a style="color: ' + ao3_accent + ';">🔄 Refresh read works</a>');
        drop_menu.on('click', 'li.refresh-reads', function () {
            readWorksSet.clear();
            localStorage.removeItem('ao3_read_works');
            alert('Please navigate to your AO3 Reading History page to refresh the list of read works. The script will automatically extract them.');
        });

        // create button - sync full history
        var button_sync_full = $('<li class="full-history-sync"></li>').html('<a style="color: ' + ao3_accent + '; font-weight: bold;">🔄 Sync Full History</a>');
        drop_menu.on('click', 'li.full-history-sync', function () {
            syncFullHistory(button_sync_full);
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

            $('ul.sorting.actions li:nth-child(3)').after('\n', button_sort_stats);
        }
    }


    // Extract read works from AO3 history
    function extractReadWorks() {
        // Check if we're on a history page or if we need to navigate there
        var currentUrl = window.location.href;
        
        // If on history page, extract works
        if (currentUrl.indexOf('/users/') !== -1 && (currentUrl.indexOf('/readings') !== -1 || currentUrl.indexOf('/works') !== -1)) {
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

    // Scrape work IDs from HTML string
    function scrapeWorkIdsFromHTML(htmlToScrape) {
        var workIds = new Set();
        var $html = $(htmlToScrape);
        
        // Find all links that point to /works/
        $html.find('a[href*="/works/"]').each(function() {
            var workLink = $(this).attr('href');
            if (workLink && workLink.indexOf('/works/') !== -1) {
                var workId = workLink.match(/\/works\/(\d+)/);
                if (workId && workId[1]) {
                    workIds.add(workId[1]);
                }
            }
        });
        
        return workIds;
    }

    // Extract work IDs from current page
    function extractFromCurrentPage() {
        var foundIds = scrapeWorkIdsFromHTML($(document));
        
        // Add found IDs to global readWorksSet
        foundIds.forEach(function(id) {
            readWorksSet.add(id);
        });

        // Save to localStorage
        if (readWorksSet.size > 0) {
            localStorage.setItem('ao3_read_works', JSON.stringify([...readWorksSet]));
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
            
            var firstPageResponse = await fetch(baseUrl);
            if (!firstPageResponse.ok) {
                throw new Error('Failed to fetch history page: ' + firstPageResponse.status);
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
                // Throttle: wait 1.5 seconds between requests
                await new Promise(function(resolve) {
                    setTimeout(resolve, 1500);
                });
                
                // Update button text with progress
                buttonElement.find('a').text('Syncing page ' + page + '/' + totalPages + '...');
                
                // Construct page URL
                var pageUrl = baseUrl;
                if (pageUrl.indexOf('?') !== -1) {
                    pageUrl = pageUrl.replace(/\?.*$/, '') + '?page=' + page;
                } else {
                    pageUrl = pageUrl + '?page=' + page;
                }
                
                try {
                    // Fetch the page
                    var pageResponse = await fetch(pageUrl);
                    if (!pageResponse.ok) {
                        console.warn('Failed to fetch page ' + page + ': ' + pageResponse.status);
                        continue; // Skip this page but continue with others
                    }
                    
                    var pageHTML = await pageResponse.text();
                    
                    // Extract work IDs from this page
                    var pageIds = scrapeWorkIdsFromHTML(pageHTML);
                    pageIds.forEach(function(id) {
                        readWorksSet.add(id);
                    });
                    
                } catch (error) {
                    console.warn('Error fetching page ' + page + ':', error);
                    // Continue with next page even if one fails
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
            
        } catch (error) {
            console.error('Error during full history sync:', error);
            buttonElement.find('a').text('🔄 Sync Full History');
            alert('Error during sync: ' + error.message + '. Some works may have been saved. Please try again.');
        }
    }

    // Highlight works that have been read (only on search pages)
    function highlightReadWorks() {
        var currentUrl = window.location.href;
        
        // Skip if on user pages (readings, bookmarks, works, etc)
        if (currentUrl.indexOf('/users/') !== -1) {
            return;
        }
        
        // Skip if on individual work pages
        if (currentUrl.match(/\/works\/\d+$/) || currentUrl.match(/\/works\/\d+\?/)) {
            return;
        }
        
        // Only highlight on search/browse result pages
        $('li.work.blurb, li.bookmark').each(function() {
            var $work = $(this);
            var workLink = $work.find('h4.heading a, dd.chapters a, a').first().attr('href');
            
            if (workLink && workLink.indexOf('/works/') !== -1) {
                var workId = workLink.match(/\/works\/(\d+)/);
                if (workId && workId[1] && readWorksSet.has(workId[1])) {
                    $work.css('background-color', read_highlight_color);
                    $work.css('border-left', '3px solid ' + ao3_accent);
                    $work.css('margin-left', '-3px');
                    $work.css('padding-left', '8px');
                }
            }
        });
    }

    // Display ratings and update information
    function displayRatingsAndUpdates() {
        $('li.work.blurb, li.bookmark').each(function() {
            var $work = $(this);
            var workLink = $work.find('h4.heading a, dd.chapters a, a').first().attr('href');
            
            if (workLink && workLink.indexOf('/works/') !== -1) {
                var workId = workLink.match(/\/works\/(\d+)/);
                if (workId && workId[1]) {
                    var workIdNum = workId[1];
                    var metadata = workMetadata[workIdNum] || {};
                    
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
        }
    }

    // Background extraction of full history
    async function backgroundExtractHistory() {
        if (syncInProgress) {
            return;
        }
        
        try {
            syncInProgress = true;
            
            // Get current URL
            var baseUrl = window.location.href;
            
            // Remove page parameter if exists
            if (baseUrl.indexOf('?') !== -1) {
                baseUrl = baseUrl.split('?')[0];
            }
            
            // Extract from current page
            extractFromCurrentPage();
            
            // Try to find total pages from pagination
            var $pagination = $('ol.pagination');
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
            
            // If there are multiple pages and we haven't synced recently, start background sync
            if (totalPages > 1) {
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
                    console.log('Starting background sync of ' + totalPages + ' pages...');
                    
                    // Fetch other pages in background
                    for (var page = 2; page <= totalPages; page++) {
                        // Throttle requests to be polite to AO3 servers
                        await new Promise(function(resolve) {
                            setTimeout(resolve, 1500); // Wait 1.5 seconds between requests
                        });
                        
                        try {
                            var pageUrl = baseUrl + '?page=' + page;
                            var pageResponse = await fetch(pageUrl);
                            
                            if (pageResponse.ok) {
                                var pageHTML = await pageResponse.text();
                                var pageIds = scrapeWorkIdsFromHTML(pageHTML);
                                pageIds.forEach(function(id) {
                                    readWorksSet.add(id);
                                });
                                localStorage.setItem('ao3_read_works', JSON.stringify([...readWorksSet]));
                                console.log('Synced page ' + page + '/' + totalPages + ' (' + readWorksSet.size + ' total works)');
                            }
                        } catch (error) {
                            console.warn('Error fetching page ' + page + ':', error);
                        }
                    }
                    
                    localStorage.setItem('ao3_last_sync', Date.now().toString());
                    console.log('Background sync complete! Total works: ' + readWorksSet.size);
                    
                    if (highlight_read) {
                        highlightReadWorks();
                    }
                }
            }
        } catch (error) {
            console.error('Error during background sync:', error);
        } finally {
            syncInProgress = false;
        }
    }

})(jQuery);

