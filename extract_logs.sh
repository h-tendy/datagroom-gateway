#!/bin/bash

# Extract log lines from datagroom.log between a start and optional end timestamp.
# Uses awk for streaming (line-by-line) processing — no full file load into memory.

LOG_FILE="datagroom.log"

if [ ! -f "$LOG_FILE" ]; then
    echo "Error: $LOG_FILE not found in current directory."
    exit 1
fi

# Prompt for start date and time
read -p "Enter start date (DD/MM/YYYY): " START_DATE
read -p "Enter start time (HH:MM:SS): " START_TIME

# Prompt for end date and time (optional)
read -p "Enter end date (DD/MM/YYYY) [press Enter to skip]: " END_DATE
if [ -n "$END_DATE" ]; then
    read -p "Enter end time (HH:MM:SS): " END_TIME
fi

# Prompt for output file name
read -p "Enter output file name: " OUTPUT_FILE

if [ -z "$OUTPUT_FILE" ]; then
    echo "Error: Output file name cannot be empty."
    exit 1
fi

if [ -f "$OUTPUT_FILE" ]; then
    read -p "File '$OUTPUT_FILE' already exists. Overwrite? (y/n): " CONFIRM
    if [ "$CONFIRM" != "y" ]; then
        echo "Aborted."
        exit 0
    fi
fi

# Convert DD/MM/YYYY HH:MM:SS to a comparable numeric string YYYYMMDDHHMMSS
to_comparable() {
    local date_str="$1"  # DD/MM/YYYY
    local time_str="$2"  # HH:MM:SS
    local day="${date_str:0:2}"
    local month="${date_str:3:2}"
    local year="${date_str:6:4}"
    local hh="${time_str:0:2}"
    local mm="${time_str:3:2}"
    local ss="${time_str:6:2}"
    echo "${year}${month}${day}${hh}${mm}${ss}"
}

START_CMP=$(to_comparable "$START_DATE" "$START_TIME")

if [ -n "$END_DATE" ]; then
    END_CMP=$(to_comparable "$END_DATE" "$END_TIME")
    HAS_END=1
else
    END_CMP=""
    HAS_END=0
fi

echo "Extracting logs from $START_DATE $START_TIME to ${END_DATE:-end of file} ${END_TIME:-}..."
echo "Writing to: $OUTPUT_FILE"

# Use awk for streaming line-by-line processing (POSIX-compatible)
awk -v start_cmp="$START_CMP" -v end_cmp="$END_CMP" -v has_end="$HAS_END" '
{
    # Find "time":" and extract the timestamp after it
    idx = index($0, "\"time\":\"")
    if (idx > 0) {
        # Move past "time":"  (8 chars)
        ts = substr($0, idx + 8, 19)
        # ts is now like: 29/03/2026, 11:03:30
        # Extract parts: DD/MM/YYYY, HH:MM:SS
        day = substr(ts, 1, 2)
        month = substr(ts, 4, 2)
        year = substr(ts, 7, 4)
        hh = substr(ts, 13, 2)
        mm = substr(ts, 16, 2)
        ss = substr(ts, 19, 2)
        line_cmp = year month day hh mm ss

        # Exit early if past end time (logs are chronological)
        if (has_end == 1 && line_cmp > end_cmp) {
            exit
        }

        if (line_cmp >= start_cmp) {
            print
        }
    }
}
' "$LOG_FILE" > "$OUTPUT_FILE"

LINE_COUNT=$(wc -l < "$OUTPUT_FILE")
echo "Done. Extracted $LINE_COUNT lines to '$OUTPUT_FILE'."
