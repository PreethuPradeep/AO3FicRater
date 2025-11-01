# AO3 Fic Rater & Tracker
This is a browser userscript designed to enhance the user experience on the high-traffic, data-heavy website Archive of Our Own. It injects a new UI and data layer to provide users with advanced sorting, tracking, and data analysis tools.

This project serves as a case study in client-side data management and asynchronous web scraping, built to solve the problem of managing a read history spanning thousands of entries.

## User Features
  ### Kudos/Hits Ratio:
    Automatically calculates and displays the Kudos/Hits percentage on all fic blurbs, with color-coding for high/medium/low engagement.
  
  ### Full History Sync:
    A one-click tool that scrapes your entire AO3 reading history (even 650+ pages) and saves it locally.
  
  ### Read History Highlighting:
    Highlights all fics from your synced history with a (default) red background, so you never lose track of what you've read.
  
  ### Custom 0-9 Rating System:
    Adds a [Rate 0-9] button to all fics, allowing you to apply and save a personal rating.
  
  ### Manual Progress Tracking:
    Adds a [✓ Mark as Read] button that saves your progress (current chapter count and date).
  
  ### Automatic Update Notifications:
    The script compares your saved progress to the fic's current stats and injects a "⚠ Updated!" warning if new chapters have been posted since you last marked it as read.
  
  ### "Chapters Left" Counter:
    Works with the Update Notifications to show you exactly how many chapters you have left to read.

## Installation
  Install a Userscript Manager: You need an extension to run this script. Tampermonkey is recommended.
  
  Install the Script: Click the installation link below. Tampermonkey will open a new tab.
  
  Click here to Install AO3 Fic Rater & Tracker
  
  Confirm Installation: Click the "Install" button in the Tampermonkey tab.

## Getting Started: How to Use

### Step 1: First-Time Sync (Required)
  When you first install the script, your local database is empty. You must sync it with your AO3 history.
  
  Important: This process only needs to be run once.
  
  Teach the Script: First, go to your "My History" page on AO3. You only need to visit it once. This "teaches" the script your personal history URL.
  
  Start the Sync: Go to any other AO3 page. Click the new "Ratings & Stats" button in the main navigation bar.
  
  Click "🔄 Sync Full History (Read)".
  
  An alert will pop up telling you how many pages it found (e.g., "650 pages"). This process will take several minutes. Do not close the tab.
  
  When it's finished, you'll get a "Sync complete!" alert.
  
  Your 13,000+ fics are now saved locally, and all search pages will show your read history highlighted in red.

### Step 2: Daily Use
  Rating Fics: Click the [Rate 0-9] button on any fic to save your personal rating.
  
  Tracking Progress: When you are caught up on a fic, click the [✓ Mark as Read] button. This is the most important feature:
  
  It saves the current date and chapter count (e.g., "Chapter 10").
  
  The next time that fic updates to Chapter 11, the script will see the difference and show you: "⚠ Updated! +1 new chapter".
