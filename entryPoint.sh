#!/bin/bash

# Initialize variables with default values
devMode="OFF"
absolutePathToServerFile="server.js"


# Parse command-line arguments
while [[ $# -gt 0 ]]; do
    key="$1"
    case $key in
        devMode=*)
            devMode="${key#*=}"
            shift
            ;;
        absolutePathToServerFile=*)
            absolutePathToServerFile="${key#*=}"
            shift
            ;;
        *)
            # Unknown option
            echo "Unknown option: $1"
            exit 1
            ;;
    esac
done


# Start MongoDB
mongod --config /etc/mongod.conf &

#Wait for mongodb to start
sleep 5 &&

# Start your Node.js application
if [ "$devMode" = "ON" ]; then
    node "$absolutePathToServerFile" &
else
    node "server.js" disableAD=true &
fi

#Default command
bash
