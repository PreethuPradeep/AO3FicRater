// ==UserScript==
// @name         AO3: Kudos/hits ratio & ratings
// @description  Replace hitcount with kudos/hits percentage. Sort works by ratio or ratings. Highlight fics you've read, show updates, and track your ratings.
// @namespace    https://greasyfork.org/scripts/3144-ao3-kudos-hits-ratio
// @author       You (Original by Min)
// @version      2.0.0
// @history      2.0.0 - Corrected header permissions, fixed localstorage to GM_storage, fixed scraper bug, and implemented GM_xmlhttpRequest for syncing.
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
// @downloadURL  https://update.greasyfork.org/scripts/3144/AO3%3A%20Kudoshits%20ratio.user.js
// @updateURL    https://update.greasyfork.org/scripts/3144/AO3%3A%20Kudoshits%20ratio.meta.js
// ==/UserScript==

// ~~ SETTINGS ~~ //
var always_count = true;
var always_sort = false;
var hide_hitcount = true;
var highlight_read = true;
var colourbg = true;
var ratio_red = '#ffdede';
var lvl1 = 4;
var ratio_yellow = '#fdf2a3';
var lvl2 = 7;
var ratio_green = '#c4eac3';
var read_highlight_color = 'rgba(255, 0, 0, 0.1)';
var ao3_bg = '#f8f8f8';
var ao3_text = '#333333';
var ao3_accent = '#900';
var ao3_border = '#d0d0d0';
var ao3_secondary = '#666';
// ~~ END OF SETTINGS ~~ //

// Global storage
var readWorksSet = new Set();
var readWorksExtracted = false;
var workMetadata = {};

// STUFF HAPPENS BELOW //

(function ($) {

    // check user settings
    // Use GM_getValue which is async, so we wrap our main logic
    Promise.all([
        GM_getValue('alwayscountlocal', 'yes'),
        GM_getValue('alwayssortlocal', 'no'),
        GM_getValue('hidehitcountlocal', 'yes'),
        GM_getValue('highlightreadlocal', 'yes'),
        GM_getValue('ao3_read_works', '[]'),
        GM_getValue('ao3_work_metadata', '{}')
    ]).then(function(values) {
        
        always_count = (values[0] == 'yes');
        always_sort = (values[1] == 'yes');
        hide_hitcount = (values[2] == 'yes');
        highlight_read = (values[3] == 'yes');

        try {
            var workIds = JSON.parse(values[4]);
            readWorksSet = new Set(workIds);
            readWorksExtracted = true;
        } catch (e) {
            console.log('Failed to parse stored read works');
            readWorksSet = new Set();
        }

        try {
            workMetadata = JSON.parse(values[5]);
        } catch (e) {
            console.log('Failed to parse stored work metadata');
            workMetadata = {};
        }

        // Now that all settings and data are loaded, run the script
        runMainScript();
    });

    function runMainScript() {
        var countable = false;
        var sortable = false;
        var stats_page = false;

        checkCountable();
        
        // This function now just saves the URL if we're on the history page
        checkAndStoreHistoryUrl();

        if (always_count) {
            countRatio();
            if (always_sort) {
                sortByRatio();
            }
        }

        if (highlight_read && readWorksExtracted) {
            highlightReadWorks();
        }

        displayRatingsAndUpdates();
        setupWorkClickTracking();
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
                stats_page = true;
                addRatioMenu();
            } else if (found_stats.parents('dl.work').length) {
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

                if (kudos_value.length && hits_value.length && hits_value.text() !== '0') {
                    var hits_count = parseInt(hits_value.text().replace(/\D/g, ''));
                    var kudos_count = parseInt(kudos_value.text().replace(/\D/g, ''));
                    var percents = 100 * kudos_count / hits_count;
                    var percents_print = percents.toFixed(1).replace('.', ',');
                    var ratio_label = $('<dt class="kudoshits"></dt>').text('Kudos/Hits:');
                    var ratio_value = $('<dd class="kudoshits"></dd>').text(percents_print + '%').css('font-weight', 'bold');
                    hits_value.after('\n', ratio_label, '\n', ratio_value);

                    if (colourbg) {
                        if (percents >= lvl2) {
                            ratio_value.css('background-color', ratio_green);
                        } else if (percents >= lvl1) {
                            ratio_value.css('background-color', ratio_yellow);
                        } else {
                            ratio_value.css('background-color', ratio_red);
                        }
                    }
                    if (hide_hitcount && !stats_page) {
                        $(this).find('.hits').css('display', 'none');
                    }
                    $(this).closest('li').attr('kudospercent', percents);
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

    // Sort works by rating
    function sortByRating(ascending) {
        if (sortable) {
            var sortable_lists = $('dl.stats').closest('li').parent();
            sortable_lists.each(function () {
                var list_elements = $(this).children('li');
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


    // attach the menu
    function addRatioMenu() {
        var header_menu = $('ul.primary.navigation.actions');
        var ratio_menu = $('<li class="dropdown"></li>').html('<a>Ratings & Stats</a>');
        header_menu.find('li.search').before(ratio_menu);
        var drop_menu = $('<ul class="menu dropdown-menu"></li>');
        ratio_menu.append(drop_menu);

        var button_count = $('<li></li>').html('<a>Count on this page</a>');
        button_count.click(function () { countRatio(); });
        var button_sort = $('<li></li>').html('<a>Sort by kudos/hits ratio</a>');
        button_sort.click(function () { sortByRatio(); });
        var button_sort_rating = $('<li></li>').html('<a>Sort by rating</a>');
        button_sort_rating.click(function () { sortByRating(); });
        var button_settings = $('<li></li>').html('<a style="padding: 0.5em 0.5em 0.25em; text-align: center; font-weight: bold; border-bottom: 1px solid ' + ao3_border + '; display: block; color: ' + ao3_text + ';">Settings</a>');

        var button_count_yes = $('<li class="count-yes"></li>').html('<a>Count automatically: YES</a>');
        drop_menu.on('click', 'li.count-yes', function () {
            GM_setValue('alwayscountlocal', 'no');
            button_count_yes.replaceWith(button_count_no);
        });
        var button_count_no = $('<li class="count-no"></li>').html('<a>Count automatically: NO</a>');
        drop_menu.on('click', 'li.count-no', function () {
            GM_setValue('alwayscountlocal', 'yes');
            button_count_no.replaceWith(button_count_yes);
        });

        var button_sort_yes = $('<li class="sort-yes"></li>').html('<a>Sort automatically: YES</a>');
        drop_menu.on('click', 'li.sort-yes', function () {
            GM_setValue('alwayssortlocal', 'no');
            button_sort_yes.replaceWith(button_sort_no);
        });
        var button_sort_no = $('<li class="sort-no"></li>').html('<a>Sort automatically: NO</a>');
        drop_menu.on('click', 'li.sort-no', function () {
            GM_setValue('alwayssortlocal', 'yes');
            button_sort_no.replaceWith(button_sort_yes);
        });

        var button_hide_yes = $('<li class="hide-yes"></li>').html('<a>Hide hitcount: YES</a>');
        drop_menu.on('click', 'li.hide-yes', function () {
            GM_setValue('hidehitcountlocal', 'no');
            $('.stats .hits').css('display', '');
            button_hide_yes.replaceWith(button_hide_no);
        });
        var button_hide_no = $('<li class="hide-no"></li>').html('<a>Hide hitcount: NO</a>');
        drop_menu.on('click', 'li.hide-no', function () {
            GM_setValue('hidehitcountlocal', 'yes');
            $('.stats .hits').css('display', 'none');
            button_hide_no.replaceWith(button_hide_yes);
        });

        var button_highlight_yes = $('<li class="highlight-yes"></li>').html('<a>Highlight read: YES</a>');
        drop_menu.on('click', 'li.highlight-yes', function () {
            GM_setValue('highlightreadlocal', 'no');
            $('li.work.blurb, li.bookmark').css({ // Clear styles on bookmarks too
                'background-color': '',
                'border-left': '',
                'margin-left': '',
                'padding-left': ''
            });
            button_highlight_yes.replaceWith(button_highlight_no);
        });
        var button_highlight_no = $('<li class="highlight-no"></li>').html('<a>Highlight read: NO</a>');
        drop_menu.on('click', 'li.highlight-no', function () {
            GM_setValue('highlightreadlocal', 'yes');
            if (readWorksExtracted) {
                highlightReadWorks();
            }
            button_highlight_no.replaceWith(button_highlight_yes);
        });

        var button_refresh = $('<li class="refresh-reads"></li>').html('<a style="color: ' + ao3_accent + ';">🔄 Refresh read works</a>');
        drop_menu.on('click', 'li.refresh-reads', function () {
            GM_deleteValue('ao3_read_works');
            readWorksSet.clear();
            alert('Local history cleared. Click "Sync Full History" or visit your AO3 History page to rebuild it.');
        });

        var button_sync_full = $('<li class="full-history-sync"></li>').html('<a style="color: ' + ao3_accent + '; font-weight: bold;">🔄 Sync Full History</a>');
        drop_menu.on('click', 'li.full-history-sync', function () {
            syncFullHistory(button_sync_full);
        });

        drop_menu.append(button_count);
        if (sortable) {
            drop_menu.append(button_sort);
            drop_menu.append(button_sort_rating);
        }
        drop_menu.append(button_settings);
        if (always_count) { drop_menu.append(button_count_yes); } else { drop_menu.append(button_count_no); }
        if (always_sort) { drop_menu.append(button_sort_yes); } else { drop_menu.append(button_sort_no); }
        if (hide_hitcount) { drop_menu.append(button_hide_yes); } else { drop_menu.append(button_hide_no); }
        if (highlight_read) { drop_menu.append(button_highlight_yes); } else { drop_menu.append(button_highlight_no); }
        drop_menu.append(button_refresh);
        drop_menu.append(button_sync_full);

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


    // If on history page, save the URL for background syncs
    function checkAndStoreHistoryUrl() {
        var currentUrl = window.location.href;
        if (currentUrl.indexOf('/users/') !== -1 && currentUrl.indexOf('/readings') !== -1) {
            var historyUrl = currentUrl.split('?')[0]; // Remove page parameter
            GM_setValue('ao3_history_url', historyUrl);
            
            // Also scrape the current page while we're here
            var foundIds = scrapeWorkIdsFromHTML($(document));
            foundIds.forEach(id => readWorksSet.add(id));
            GM_setValue('ao3_read_works', JSON.stringify([...readWorksSet]));
        }
    }

    // *** BUG FIX ***
    // This function now *only* scrapes the main title links
    function scrapeWorkIdsFromHTML(htmlToScrape) {
        var workIds = new Set();
        var $html = $(htmlToScrape);
        
        // This is the specific, correct selector
        $html.find('li.work h4.heading a, li.bookmark h4.heading a').each(function() {
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


    // Helper function to fetch a page using GM_xmlhttpRequest
    function fetchPage(url) {
        return new Promise((resolve, reject) => {
            GM_xmlhttpRequest({
                method: "GET",
                url: url,
                onload: function(response) {
                    if (response.status >= 200 && response.status < 400) {
                        resolve(response.responseText);
                    } else {
                        reject(new Error('Failed to fetch page: ' + response.status));
                    }
                },
                onerror: function(error) {
                    reject(new Error('Network error: ' + error));
                }
            });
        });
    }


    // Sync full history by fetching all pages
    async function syncFullHistory(buttonElement) {
        try {
            var baseUrl = await GM_getValue('ao3_history_url');
            
            if (!baseUrl) {
                 // Try to find it on the page if not in storage
                var historyLink = $('a[href^="/users/"][href*="/readings"]').first();
                if (historyLink.length > 0) {
                    baseUrl = historyLink.attr('href').split('?')[0];
                    if (baseUrl.indexOf('http') !== 0) {
                        baseUrl = window.location.origin + baseUrl;
                    }
                    await GM_setValue('ao3_history_url', baseUrl);
                } else {
                    alert('Could not find your history URL. Please navigate to your AO3 "My History" page once to teach the script where it is, then try again.');
                    return;
                }
            }
            
            if (baseUrl.indexOf('http') !== 0) {
                baseUrl = window.location.origin + baseUrl;
            }

            buttonElement.find('a').text('Syncing... Fetching page 1...');
            
            var firstPageHTML = await fetchPage(baseUrl);
            var $firstPage = $(firstPageHTML);
            
            var firstPageIds = scrapeWorkIdsFromHTML(firstPageHTML);
            firstPageIds.forEach(id => readWorksSet.add(id));
            
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
            
            alert('Starting full history sync for ' + totalPages + ' pages. This will take several minutes. Please leave this tab open.');
            
            for (var page = 2; page <= totalPages; page++) {
                await new Promise(resolve => setTimeout(resolve, 1500)); // 1.5 second throttle
                
                buttonElement.find('a').text('Syncing page ' + page + '/' + totalPages + '...');
                var pageUrl = baseUrl + '?page=' + page;
                
                try {
                    var pageHTML = await fetchPage(pageUrl);
                    var pageIds = scrapeWorkIdsFromHTML(pageHTML);
                    pageIds.forEach(id => readWorksSet.add(id));
                    
                } catch (error) {
                    console.warn('Error fetching page ' + page + ':', error);
                }
            }
            
            await GM_setValue('ao3_read_works', JSON.stringify([...readWorksSet]));
            
            buttonElement.find('a').text('🔄 Sync Full History');
            alert('Full history sync complete! ' + readWorksSet.size + ' works have been saved. Please refresh the page to see highlights.');
            
            readWorksExtracted = true;
            highlightReadWorks();
            
        } catch (error) {
            console.error('Error during full history sync:', error);
            buttonElement.find('a').text('🔄 Sync Full History');
            alert('Error during sync: ' + error.message + '. Some works may have been saved. Please try again.');
        }
    }

    // Highlight works that have been read (only on search pages)
    function highlightReadWorks() {
        var currentUrl = window.location.href;
        if (currentUrl.indexOf('/users/') !== -1) {
            return; // Skip on user pages
        }
        if (currentUrl.match(/\/works\/\d+/)) {
             return; // Skip on individual work pages
        }
        
        $('li.work.blurb, li.bookmark').each(function() {
            var $work = $(this);
            var workLink = $work.find('h4.heading a').first().attr('href');
            
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
            var workLink = $work.find('h4.heading a').first().attr('href');
            
            if (workLink && workLink.indexOf('/works/') !== -1) {
                var workId = workLink.match(/\/works\/(\d+)/);
                if (workId && workId[1]) {
                    var workIdNum = workId[1];
                    var metadata = workMetadata[workIdNum] || {};
                    var isRead = readWorksSet.has(workIdNum);
                    var $stats = $work.find('dl.stats');
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
                    
                    var $updateDate = $work.find('.datetime');
                    var updateDateStr = $updateDate.attr('title') || $updateDate.text();
                    var updateDate = parseDate(updateDateStr);
                    
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
                    
                    $ratingContainer.find('.custom-rating').off('click').on('click', function(e) {
                        e.preventDefault();
                        e.stopPropagation();
                        promptRating(workIdNum);
                    });
                    
                    if (isRead && highlight_read) {
                        var $readInfoContainer = $work.find('.custom-read-info-container');
                        if ($readInfoContainer.length === 0) {
                            $readInfoContainer = $('<div class="custom-read-info-container"></div>');
                            $stats.prepend($readInfoContainer);
                        }
                        
                        var readInfoHTML = '';
                        if (metadata.lastReadDate) {
                            var lastReadDate = parseDate(metadata.lastReadDate);
                            if (lastReadDate) {
                                var formattedDate = formatReadableDate(lastReadDate);
                                readInfoHTML += '<dt style="color:' + ao3_secondary + ';">Last read:</dt>';
                                readInfoHTML += '<dd style="color:' + ao3_secondary + ';">' + formattedDate + '</dd>';
                            }
                        }
                        
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
                    
                    if (metadata.lastReadDate && metadata.lastReadChapters !== undefined && updateDate) {
                        var lastReadDate = parseDate(metadata.lastReadDate);
                        
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
    
    // This is the function that automatically updates your read history!
    function setupWorkClickTracking() {
        $(document).on('click', 'li.work.blurb h4.heading a, li.bookmark h4.heading a', function(e) {
            var $link = $(this);
            var workLink = $link.attr('href');
            
            if (workLink && workLink.indexOf('/works/') !== -1) {
                var workId = workLink.match(/\/works\/(\d+)/);
                if (workId && workId[1]) {
                    var workIdNum = workId[1];
                    var $work = $link.closest('li.work.blurb, li.bookmark');
                    var $chapters = $work.find('dd.chapters');
                    var chapterText = $chapters.text().trim();
                    var currentChapters = 0;
                    
                    if (chapterText) {
                        var chapterMatch = chapterText.match(/(\d+)/);
                        if (chapterMatch) {
                            currentChapters = parseInt(chapterMatch[1]);
                        }
                    }
                    
                    if (!workMetadata[workIdNum]) {
                        workMetadata[workIdNum] = {};
                    }
                    workMetadata[workIdNum].lastReadDate = new Date().toISOString();
                    workMetadata[workIdNum].lastReadChapters = currentChapters;
                    
                    // Also add to read set immediately
                    if (!readWorksSet.has(workIdNum)) {
                         readWorksSet.add(workIdNum);
                         GM_setValue('ao3_read_works', JSON.stringify([...readWorksSet]));
                    }
                   
                    saveMetadata();
                }
            }
        });
    }

    function getRatingColor(rating) {
        if (rating >= 8) return '#5cb85c';
        if (rating >= 6) return '#5bc0de';
        if (rating >= 4) return '#f0ad4e';
        if (rating >= 2) return '#d9534f';
        return '#999999';
    }

    function parseDate(dateStr) {
        if (!dateStr) return null;
        
        // Handle "Last updated: January 15, 2025" format
        dateStr = dateStr.replace(/Last updated:\s*/i, '');

        // Handle "31 Dec 2024" format
        var match = dateStr.match(/(\d{1,2})\s(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s(\d{4})/);
        if (match) {
            return new Date(match[2] + ' ' + match[1] + ', ' + match[3]);
        }
        
        // Handle "YYYY-MM-DD" format
        match = dateStr.match(/(\d{4})-(\d{2})-(\d{2})/);
        if (match) {
            return new Date(dateStr);
        }

        // Try standard parsing as a fallback
        var date = new Date(dateStr);
        if (!isNaN(date.getTime())) {
            return date;
        }
        
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
        var diffWeeks = Math.floor(diffDays / 7);
        var diffMonths = Math.floor(diffDays / 30);
        var diffYears = Math.floor(diffDays / 365);
        
        if (diffSecs < 60) { return 'Just now'; }
        else if (diffMins < 60) { return diffMins + ' minute' + (diffMins > 1 ? 's' : '') + ' ago'; }
        else if (diffHours < 24) { return diffHours + ' hour' + (diffHours > 1 ? 's' : '') + ' ago'; }
        else if (diffDays < 7) { return diffDays + ' day' + (diffDays > 1 ? 's' : '') + ' ago'; }
        else if (diffWeeks < 4) { return diffWeeks + ' week' + (diffWeeks > 1 ? 's' : '') + ' ago'; }
        else if (diffMonths < 12) { return diffMonths + ' month' + (diffMonths > 1 ? 's' : '') + ' ago'; }
        else if (diffYears < 2) { return diffYears + ' year ago'; }
        else {
            var months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
            return months[date.getMonth()] + ' ' + date.getDate() + ', ' + date.getFullYear();
        }
    }

    function saveMetadata() {
        GM_setValue('ao3_work_metadata', JSON.stringify(workMetadata));
    }

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

    function setRating(workId, rating) {
        if (!workMetadata[workId]) {
            workMetadata[workId] = {};
        }
        workMetadata[workId].rating = rating;
        saveMetadata();
        displayRatingsAndUpdates();
    }
   
    // Removed the complex auto-sync functions as they are buggy
    // The manual "Sync Full History" button is the reliable method.
    // The `setupWorkClickTracking` function handles automatic updates when you read.

})(window.jQuery);