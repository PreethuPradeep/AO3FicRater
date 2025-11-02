// ==UserScript==
// @name         AO3 Fic Rater & Tracker
// @description  Adds Kudos/Hits ratio, read highlighting (red), custom ratings, and update tracking to AO3.
// @namespace    https://github.com/PreethuPradeep/AO3FicRater
// @author       PeetaMellark
// @version      4.0.0
// @history      4.0.0 - FINAL VERSION. Removed all aggressive auto-sync functions (which caused 429 errors). Replaced ALL localStorage/fetch calls with GM_storage/GM_xmlhttpRequest. Fixed all scope bugs.
// @history      3.2.4 - Attempted to fix rate limiting with progressive backoff.
// @history      3.2.0 - Added bookmarks extraction.
// @history      3.1.0 - Removed kudos-tracking.
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

/*
MIT License

Copyright (c) 2025 PreethuPradeep

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
*/

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
var bookmark_highlight_color = 'rgba(0, 128, 255, 0.1)';
// AO3 theme colors
var ao3_bg = '#f8f8f8';
var ao3_text = '#333333';
var ao3_accent = '#900';
var ao3_border = '#d0d0d0';
var ao3_secondary = '#666';
// ~~ END OF SETTINGS ~~ //

// Global storage
var readWorksSet = new Set();
var bookmarkedWorksSet = new Set();
var workMetadata = {};
var syncInProgress = false;

// Script-level scope for shared variables
var countable = false;
var sortable = false;
var stats_page = false;


(function ($) {
    console.log('%c[AO3 RATER]: Script loading...', 'color: #008080; font-weight: bold;');

    // Load ALL data from GM_storage before doing anything
    Promise.all([
        GM_getValue('alwayscountlocal', 'yes'),
        GM_getValue('alwayssortlocal', 'no'),
        GM_getValue('hidehitcountlocal', 'yes'),
        GM_getValue('highlightreadlocal', 'yes'),
        GM_getValue('ao3_read_works', '[]'),
        GM_getValue('ao3_bookmarks', '[]'),
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
            bookmarkedWorksSet = new Set(JSON.parse(values[5]));
            console.log(`[AO3 RATER]: Loaded ${bookmarkedWorksSet.size} Bookmarked Work IDs.`);
        } catch (e) {
            console.error('[AO3 RATER]: Failed to parse stored bookmarks!', e);
            bookmarkedWorksSet = new Set();
        }

        try {
            workMetadata = JSON.parse(values[6]);
            console.log(`[AO3 RATER]: Loaded Metadata for ${Object.keys(workMetadata).length} works.`);
        } catch (e) {
            console.error('[AO3 RATER]: Failed to parse stored work metadata!', e);
            workMetadata = {};
        }

        // Now that all data is loaded, run the main script
        runMainScript();
    });

    /**
     * This is the main function that runs after all async data is loaded.
     */
    function runMainScript() {
        console.log('[AO3 RATER]: Running main script functions...');

        checkCountable();
        checkAndStorePageUrl(); // Stores History or Bookmark URL if we're on one

        if (always_count) {
            countRatio();
            if (always_sort) {
                sortByRatio();
            }
        }

        displayRatingsAndUpdates(); // This now does highlighting AND button injection
        setupWorkPageTracking(); // This handles auto-saving when *visiting* a work page

        console.log('[AO3 RATER]: Main script functions complete.');
    }


    /**
     * Checks if the page has countable/sortable stats and adds the menu if so.
     */
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

    /**
     * Adds the "Ratings & Stats" menu to the main AO3 header.
     */
    function addRatioMenu() {
        console.log('[AO3 RATER]: Adding "Ratings & Stats" menu to header.');
        var header_menu = $('ul.primary.navigation.actions');
        var ratio_menu = $('<li class="dropdown"></li>').html('<a>Ratings & Stats</a>');
        header_menu.find('li.search').before(ratio_menu);
        var drop_menu = $('<ul class="menu dropdown-menu"></li>');
        ratio_menu.append(drop_menu);

        // --- Standard Buttons ---
        drop_menu.append($('<li></li>').html('<a>Count on this page</a>').on('click', countRatio));
        if (sortable) {
            drop_menu.append($('<li></li>').html('<a>Sort by kudos/hits ratio</a>').on('click', () => sortByRatio(false)));
            drop_menu.append($('<li></li>').html('<a>Sort by rating</a>').on('click', () => sortByRating(false)));
        }
        drop_menu.append($('<li></li>').html('<a style="padding: 0.5em 0.5em 0.25em; text-align: center; font-weight: bold; border-bottom: 1px solid ' + ao3_border + '; display: block; color: ' + ao3_text + ';">Settings</a>'));

        // --- Toggle Buttons ---
        addToggle(drop_menu, 'alwayscountlocal', 'Count automatically', always_count, (val) => { always_count = val; });
        addToggle(drop_menu, 'alwayssortlocal', 'Sort automatically', always_sort, (val) => { always_sort = val; });
        addToggle(drop_menu, 'hidehitcountlocal', 'Hide hitcount', hide_hitcount, (val) => {
            hide_hitcount = val;
            $('.stats .hits').css('display', hide_hitcount ? 'none' : '');
        });
        addToggle(drop_menu, 'highlightreadlocal', 'Highlight read/bookmarked', highlight_read, (val) => {
            highlight_read = val;
            displayRatingsAndUpdates(); // Re-run to show/hide highlights
        });

        // --- Sync Buttons ---
        var button_refresh = $('<li class="refresh-reads"></li>').html('<a style="color: ' + ao3_accent + ';">🔄 Clear All Local Data</a>');
        button_refresh.on('click', function () {
            if (confirm('This will delete all your saved ratings, read history, and bookmark data from this script. Are you sure?')) {
                console.log('%c[AO3 RATER]: User cleared all local data.', 'color: red; font-weight: bold;');
                GM_deleteValue('ao3_read_works');
                GM_deleteValue('ao3_bookmarks');
                GM_deleteValue('ao3_work_metadata');
                GM_deleteValue('ao3_history_url');
                GM_deleteValue('ao3_bookmarks_url');
                readWorksSet.clear();
                bookmarkedWorksSet.clear();
                workMetadata = {};
                alert('All local data cleared. Please refresh the page.');
            }
        });
        drop_menu.append(button_refresh);

        var button_sync_full = $('<li class="full-history-sync"></li>').html('<a style="color: ' + ao3_accent + '; font-weight: bold;">🔄 Sync Full History (Read)</a>');
        button_sync_full.on('click', function () {
            runFullSync(this, 'History');
        });
        drop_menu.append(button_sync_full);

        var button_sync_bookmarks = $('<li class="full-bookmarks-sync"></li>').html('<a style="color: #0080ff; font-weight: bold;">📑 Sync Full Bookmarks</a>');
        button_sync_bookmarks.on('click', function () {
            runFullSync(this, 'Bookmarks');
        });
        drop_menu.append(button_sync_bookmarks);
    }

    /**
     * Helper to create a toggle button for the menu.
     */
    function addToggle(menu, key, text, initialValue, callback) {
        var $button = $(initialValue ? `<li><a>${text}: YES</a></li>` : `<li><a>${text}: NO</a></li>`);
        $button.on('click', function() {
            var newValue = !initialValue;
            GM_setValue(key, newValue ? 'yes' : 'no');
            $(this).find('a').text(`${text}: ${newValue ? 'YES' : 'NO'}`);
            callback(newValue);
            initialValue = newValue; // Update closure
        });
        menu.append($button);
    }

    /**
     * Helper function to fetch a page using GM_xmlhttpRequest.
     * This has built-in throttling and retries for 429 errors.
     */
    function fetchPage(url, retries = 0, maxRetries = 10, progressiveBackoff = 0) {
        return new Promise((resolve, reject) => {
            GM_xmlhttpRequest({
                method: "GET",
                url: url,
                onload: function(response) {
                    if (response.status >= 200 && response.status < 400) {
                        resolve(response.responseText);
                    } else if (response.status === 429 && retries < maxRetries) {
                        // Rate Limited! Wait and retry.
                        var waitTime = (20 + progressiveBackoff) * 1000; // 20s, 25s, 30s...
                        console.warn(`[AO3 RATER]: Rate limited (429) on ${url}. Waiting ${waitTime/1000}s... (Retry ${retries + 1}/${maxRetries})`);
                        setTimeout(() => {
                            fetchPage(url, retries + 1, maxRetries, progressiveBackoff + 5)
                                .then(resolve)
                                .catch(reject);
                        }, waitTime);
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

    /**
     * Scrapes *only* the main work ID links from a page of blurbs.
     */
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

    /**
     * Generic sync function for both History and Bookmarks.
     */
    async function runFullSync(buttonElement, syncType) {
        if (syncInProgress) {
            alert('A sync is already in progress. Please wait.');
            return;
        }
        syncInProgress = true;
        console.log(`%c[SYNC ${syncType}]: Starting...`, 'color: blue; font-weight: bold;');

        var urlKey, dataKey, pageType, userLink, dataSet;

        if (syncType === 'History') {
            urlKey = 'ao3_history_url';
            dataKey = 'ao3_read_works';
            pageType = '/readings';
            userLink = $('a[href^="/users/"][href*="/readings"]').first();
            dataSet = readWorksSet;
        } else { // Bookmarks
            urlKey = 'ao3_bookmarks_url';
            dataKey = 'ao3_bookmarks';
            pageType = '/bookmarks';
            userLink = $('a[href^="/users/"][href*="/bookmarks"]').first();
            dataSet = bookmarkedWorksSet;
        }

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

            var firstPageHTML = await fetchPage(baseUrl, 0, 3, 0); // 3 retries, 0s, 20s, 25s backoff
            var $firstPage = $(firstPageHTML);

            var originalSize = dataSet.size;

            var firstPageIds = scrapeWorkIdsFromHTML(firstPageHTML);
            firstPageIds.forEach(id => dataSet.add(id));

            // --- *** CORRECTED PAGINATION LOGIC *** ---
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
            alert(`Starting full ${syncType} sync for ${totalPages} pages. This will take a few minutes. Please leave this tab open.`);

            for (var page = 2; page <= totalPages; page++) {
                // Use the fetchPage function which has built-in retries
                var statusText = `Syncing page ${page}/${totalPages}...`;
                $(buttonElement).find('a').text(statusText);
                console.log(`[SYNC ${syncType}]: ${statusText}`);

                var pageUrl = baseUrl + '?page=' + page;

                try {
                    // Start with a 3s delay, then use 20s+ backoff for 429s
                    await new Promise(resolve => setTimeout(resolve, 3000));
                    var pageHTML = await fetchPage(pageUrl, 0, 10, 0); // 10 retries, 20s, 25s, ...
                    var pageIds = scrapeWorkIdsFromHTML(pageHTML);
                    pageIds.forEach(id => dataSet.add(id));

                } catch (error) {
                    // Log error but continue to next page
                    console.error(`[SYNC ${syncType}]: FAILED to fetch page ${page}. Moving on...`, error);
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

    /**
     * If on history/bookmarks page, save the URL for background syncs.
     */
    function checkAndStorePageUrl() {
        var currentUrl = window.location.href;
        if (currentUrl.indexOf('/users/') !== -1) {
            if (currentUrl.indexOf('/readings') !== -1) {
                console.log('[AO3 RATER]: On History page. Storing URL.');
                GM_setValue('ao3_history_url', currentUrl.split('?')[0]);
            } else if (currentUrl.indexOf('/bookmarks') !== -1) {
                console.log('[AO3 RATER]: On Bookmarks page. Storing URL.');
                GM_setValue('ao3_bookmarks_url', currentUrl.split('?')[0]);
            }
        }
    }

    /**
     * Main function to highlight, inject UI, and show update status.
     */
    function displayRatingsAndUpdates() {
        console.log('[AO3 RATER]: Running displayRatingsAndUpdates()...');
        var highlightedRead = 0;
        var highlightedBookmark = 0;

        var currentUrl = window.location.href;
        var isUserPage = currentUrl.indexOf('/users/') !== -1;

        $('li.work.blurb, li.bookmark').each(function() {
            var $work = $(this);
            var workLink = $work.find('h4.heading a').first().attr('href');

            if (!workLink || workLink.indexOf('/works/') === -1) return;
            var workIdMatch = workLink.match(/\/works\/(\d+)/);
            if (!workIdMatch || !workIdMatch[1]) return;

            var workId = workIdMatch[1];
            var metadata = workMetadata[workId] || {};
            var isRead = readWorksSet.has(workId);
            var isBookmarked = bookmarkedWorksSet.has(workId);

            var $stats = $work.find('dl.stats');

            // --- 1. Highlighting Logic ---
            $work.css('background-color', '').css('border-left', '').css('margin-left', '').css('padding-left', '');

            if (highlight_read && !isUserPage) { // Don't highlight on user pages
                if (isRead || metadata.lastReadChapters !== undefined) {
                    $work.css('background-color', read_highlight_color);
                    $work.css('border-left', '3px solid ' + ao3_accent);
                    $work.css('margin-left', '-3px');
                    $work.css('padding-left', '8px');
                    highlightedRead++;
                } else if (isBookmarked) {
                    $work.css('background-color', bookmark_highlight_color);
                    $work.css('border-left', '3px solid #0080ff');
                    $work.css('margin-left', '-3px');
                    $work.css('padding-left', '8px');
                    highlightedBookmark++;
                }
            }

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
                // Only show "chapters left" if there are actually new chapters
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

        console.log(`[AO3 RATER]: Display complete. Highlighted ${highlightedRead} READ and ${highlightedBookmark} BOOKMARKED works.`);

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

    /**
     * Handles the rating prompt.
     */
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

    /**
     * Saves progress when user clicks [✓ Mark as Read].
     */
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

    /**
     * Saves the metadata object to GM_storage.
     */
    function saveMetadata() {
        console.log('[AO3 RATER]: Saving workMetadata to GM_storage...');
        GM_setValue('ao3_work_metadata', JSON.stringify(workMetadata));
    }

    /**
     * Utility to parse various date formats from AO3.
     */
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

    /**
     * Utility to format a date into "X days ago".
     */
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

    /**
     * Auto-saves read progress just from *visiting* a work page.
     */
    function setupWorkPageTracking() {
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

    // --- Original Kudos/Hits Ratio Functions ---
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
                        if (hide_hitcount && !stats_page) {
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

    // --- Removed all old auto-sync functions ---
    // They were buggy and caused 429 errors. Manual sync is safer.

})(window.jQuery);
