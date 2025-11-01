// ==UserScript==
// @name         AO3 Fic Rater & Tracker
// @description  Adds Kudos/Hits ratio, read highlighting (red), kudos highlighting (blue), custom ratings, and update tracking to AO3.
// @namespace    https://github.com/PreethuPradeep/AO3FicRater
// @author       PeetaMellark (Original by Min)
// @version      3.0.0
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
// Your new colors
var read_highlight_color = 'rgba(255, 0, 0, 0.05)';
var kudos_highlight_color = 'rgba(0, 0, 255, 0.05)';
// AO3 theme colors
var ao3_bg = '#f8f8f8';
var ao3_text = '#333333';
var ao3_accent = '#900';
var ao3_border = '#d0d0d0';
var ao3_secondary = '#666';
// ~~ END OF SETTINGS ~~ //

// Global storage
var readWorksSet = new Set();
var kudosedWorksSet = new Set();
var workMetadata = {};
var syncInProgress = false;

// STUFF HAPPENS BELOW //

(function ($) {

    // We must wait for all GM_getValue calls (which are async) to finish
    // before we can run any of our code.
    Promise.all([
        GM_getValue('alwayscountlocal', 'yes'),
        GM_getValue('alwayssortlocal', 'no'),
        GM_getValue('hidehitcountlocal', 'yes'),
        GM_getValue('highlightreadlocal', 'yes'),
        GM_getValue('ao3_read_works', '[]'),
        GM_getValue('ao3_kudosed_works', '[]'), // New
        GM_getValue('ao3_work_metadata', '{}')
    ]).then(function(values) {
        
        // 1. Load all settings from storage
        always_count = (values[0] == 'yes');
        always_sort = (values[1] == 'yes');
        hide_hitcount = (values[2] == 'yes');
        highlight_read = (values[3] == 'yes');

        // 2. Load all data from storage
        try {
            readWorksSet = new Set(JSON.parse(values[4]));
        } catch (e) {
            console.log('Failed to parse stored read works');
            readWorksSet = new Set();
        }

        try {
            kudosedWorksSet = new Set(JSON.parse(values[5])); // New
        } catch (e) {
            console.log('Failed to parse stored kudosed works');
            kudosedWorksSet = new Set();
        }

        try {
            workMetadata = JSON.parse(values[6]);
        } catch (e) {
            console.log('Failed to parse stored work metadata');
            workMetadata = {};
        }

        // 3. Now that all settings and data are loaded, run the main script logic
        runMainScript();
    });

    // This function contains all your code, but now it runs
    // *after* all settings are loaded.
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

        // This function now does everything: highlights, adds buttons, and shows updates
        displayRatingsAndUpdates();
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

    // --- attach the menu ---
    function addRatioMenu() {
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
        // (Simplified to use ternary operator for cleaner code)
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
            // Refresh highlights on page
            displayRatingsAndUpdates();
        });
        drop_menu.append(button_highlight_toggle);

        // --- Sync Buttons ---
        var button_refresh = $('<li class="refresh-reads"></li>').html('<a style="color: ' + ao3_accent + ';">🔄 Clear All Local Data</a>');
        drop_menu.on('click', 'li.refresh-reads', function () {
            if (confirm('This will delete all your saved ratings, read history, and kudos data from this script. Are you sure?')) {
                GM_deleteValue('ao3_read_works');
                GM_deleteValue('ao3_kudosed_works');
                GM_deleteValue('ao3_work_metadata');
                GM_deleteValue('ao3_history_url');
                GM_deleteValue('ao3_kudos_url');
                readWorksSet.clear();
                kudosedWorksSet.clear();
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

        var button_sync_kudos = $('<li class="full-kudos-sync"></li>').html('<a style="color: ' + ao3_accent + '; font-weight: bold;">🔄 Sync Full Kudos</a>');
        drop_menu.on('click', 'li.full-kudos-sync', function () {
            syncFullKudos(this);
        });
        drop_menu.append(button_sync_kudos);
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
                        reject(new Error('Failed to fetch page: ' + response.status));
                    }
                },
                onerror: function(error) {
                    reject(new Error('Network error: ' + error));
                }
            });
        });
    }
    
    // --- Your specific scraper for fic blurbs ---
    function scrapeWorkIdsFromHTML(htmlToScrape) {
        var workIds = new Set();
        var $html = $(htmlToScrape);
        // This selector is specific to work/bookmark blurbs on search/history pages
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
    
    // --- Generic Sync Function ---
    async function runFullSync(buttonElement, syncType) {
        if (syncInProgress) {
            alert('A sync is already in progress. Please wait.');
            return;
        }
        syncInProgress = true;
        
        var urlKey, dataKey, pageType, userLink;
        
        if (syncType === 'History') {
            urlKey = 'ao3_history_url';
            dataKey = 'ao3_read_works';
            pageType = '/readings';
            userLink = $('a[href^="/users/"][href*="/readings"]').first();
        } else { // Kudos
            urlKey = 'ao3_kudos_url';
            dataKey = 'ao3_kudosed_works';
            pageType = '/kudos';
            userLink = $('a[href^="/users/"][href*="/kudos"]').first();
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

            $(buttonElement).find('a').text('Syncing... Fetching page 1...');
            
            var firstPageHTML = await fetchPage(baseUrl);
            var $firstPage = $(firstPageHTML);
            
            var dataSet = (syncType === 'History') ? readWorksSet : kudosedWorksSet;
            
            var firstPageIds = scrapeWorkIdsFromHTML(firstPageHTML);
            firstPageIds.forEach(id => dataSet.add(id));
            
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
            
            alert(`Starting full ${syncType} sync for ${totalPages} pages. This will take a few minutes. Please leave this tab open.`);
            
            for (var page = 2; page <= totalPages; page++) {
                await new Promise(resolve => setTimeout(resolve, 1500)); // 1.5 second throttle
                
                $(buttonElement).find('a').text(`Syncing page ${page}/${totalPages}...`);
                var pageUrl = baseUrl + '?page=' + page;
                
                try {
                    var pageHTML = await fetchPage(pageUrl);
                    var pageIds = scrapeWorkIdsFromHTML(pageHTML);
                    pageIds.forEach(id => dataSet.add(id));
                    
                } catch (error) {
                    console.warn(`Error fetching ${syncType} page ${page}:`, error);
                }
            }
            
            await GM_setValue(dataKey, JSON.stringify([...dataSet]));
            
            $(buttonElement).find('a').text(`🔄 Sync Full ${syncType}`);
            alert(`Full ${syncType} sync complete! ${dataSet.size} works have been saved. Please refresh the page to see highlights.`);
            
            displayRatingsAndUpdates(); // Refresh highlights
            
        } catch (error) {
            console.error(`Error during full ${syncType} sync:`, error);
            $(buttonElement).find('a').text(`🔄 Sync Full ${syncType}`);
            alert(`Error during ${syncType} sync: ${error.message}. Some works may have been saved. Please try again.`);
        } finally {
            syncInProgress = false;
        }
    }
    
    function syncFullHistory(buttonElement) {
        runFullSync(buttonElement, 'History');
    }
    
    function syncFullKudos(buttonElement) {
        runFullSync(buttonElement, 'Kudos');
    }

    // --- On history/kudos page, save the URL ---
    function checkAndStoreHistoryUrl() {
        var currentUrl = window.location.href;
        if (currentUrl.indexOf('/users/') !== -1) {
            if (currentUrl.indexOf('/readings') !== -1) {
                GM_setValue('ao3_history_url', currentUrl.split('?')[0]);
            } else if (currentUrl.indexOf('/kudos') !== -1) {
                GM_setValue('ao3_kudos_url', currentUrl.split('?')[0]);
            }
        }
    }

    // --- Highlight, Track, and Add Buttons ---
    function displayRatingsAndUpdates() {
        $('li.work.blurb, li.bookmark').each(function() {
            var $work = $(this);
            var workLink = $work.find('h4.heading a').first().attr('href');
            
            if (!workLink || workLink.indexOf('/works/') === -1) {
                return; // Not a work blurb, skip
            }
                
            var workIdMatch = workLink.match(/\/works\/(\d+)/);
            if (!workIdMatch || !workIdMatch[1]) {
                return; // No Work ID found
            }
                
            var workId = workIdMatch[1];
            var metadata = workMetadata[workId] || {};
            var isRead = readWorksSet.has(workId);
            var isKudosed = kudosedWorksSet.has(workId);
            
            var $stats = $work.find('dl.stats');

            // --- 1. Highlighting Logic ---
            if (highlight_read) {
                if (isRead || metadata.lastReadChapters !== undefined) {
                    $work.css('background-color', read_highlight_color);
                    $work.css('border-left', '3px solid ' + ao3_accent);
                    $work.css('margin-left', '-3px');
                    $work.css('padding-left', '8px');
                } else if (isKudosed) {
                    $work.css('background-color', kudos_highlight_color);
                }
            }

            // --- 2. Inject UI ---
            // Ensure container exists
            var $uiContainer = $work.find('.custom-ui-container');
            if ($uiContainer.length === 0) {
                $uiContainer = $('<div class="custom-ui-container" style="margin-top: 5px; display: flex; gap: 10px; align-items: center;"></div>');
                $stats.before($uiContainer); // Prepend above stats
            }
            
            // Get rating
            var ratingText = metadata.rating !== undefined ? `Rating: ${metadata.rating}/9` : 'Rate 0-9';
            var ratingColor = metadata.rating !== undefined ? getRatingColor(metadata.rating) : ao3_secondary;

            // Define button styles
            var buttonStyle = 'cursor:pointer; color:' + ao3_accent + '; text-decoration:none; border:1px solid ' + ao3_border + '; padding:2px 6px; border-radius:3px; display:inline-block; font-size:0.9em;';

            // Build UI HTML
            var uiHTML = `
                <span class="custom-rate-button" data-work-id="${workId}" style="${buttonStyle} color:${ratingColor};" title="Click to rate this fic">${ratingText}</span>
                <span class="custom-mark-read-button" data-work-id="${workId}" style="${buttonStyle}" title="Mark all current chapters as read">✓ Mark as Read</span>
            `;
            $uiContainer.html(uiHTML);

            // --- 3. Update Notification Logic ---
            if (metadata.lastReadChapters !== undefined) {
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
                
                // Check for new chapters
                if (lastReadDate && updateDate > lastReadDate && currentChapters > metadata.lastReadChapters) {
                    var unreadChapters = currentChapters - metadata.lastReadChapters;
                    updateMessage = `
                        <dt style="font-weight:bold; color:${ao3_accent};">⚠ Updated:</dt>
                        <dd style="color:${ao3_accent}; font-weight:bold;">+${unreadChapters} new chapter${unreadChapters > 1 ? 's' : ''}</dd>
                    `;
                }
                
                // Check for chapters left
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
                
                // Add last read date
                if (lastReadDate) {
                     updateMessage += `
                        <dt style="color:${ao3_secondary};">Last read:</dt>
                        <dd style="color:${ao3_secondary};">${formatReadableDate(lastReadDate)}</dd>
                    `;
                }

                // Inject update info
                var $updateContainer = $work.find('.custom-update-container');
                if ($updateContainer.length === 0) {
                    $updateContainer = $('<div class="custom-update-container" style="margin-top: 5px;"></div>');
                    $stats.prepend($updateContainer); // Prepend before stats, after UI
                }
                $updateContainer.html(updateMessage);
            }
        });

        // --- 4. Add Global Click Handlers for UI ---
        // Must be done *outside* the .each() loop
        
        // Handler for Rating
        $(document).off('click', '.custom-rate-button').on('click', '.custom-rate-button', function(e) {
            e.preventDefault();
            e.stopPropagation();
            var workId = $(this).data('work-id');
            promptRating(workId);
        });

        // Handler for Mark as Read
        $(document).off('click', '.custom-mark-read-button').on('click', '.custom-mark-read-button', function(e) {
            e.preventDefault();
            e.stopPropagation();
            var workId = $(this).data('work-id');
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
                saveMetadata();
                displayRatingsAndUpdates(); // Refresh page to show new rating
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
        
        // Scrape current chapters from the blurb
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
        
        // Also add to main read list
        if (!readWorksSet.has(workId)) {
            readWorksSet.add(workId);
            GM_setValue('ao3_read_works', JSON.stringify([...readWorksSet]));
        }
        
        saveMetadata();
        displayRatingsAndUpdates(); // Refresh UI
    }

    // --- Utility Functions ---
    function saveMetadata() {
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
    
    if (dateStr.indexOf('T') > -1) { // Handle ISO dates
         var isoDate = new Date(dateStr);
         if (!isNaN(isoDate.getTime())) return isoDate;
    }

    var date = new Date(dateStr); // Fallback
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
    
    // --- Functions from the original script ---
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
                    hits_value.after(ratio_label, ratio_value);

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
