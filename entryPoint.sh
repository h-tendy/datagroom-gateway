#!/bin/bash

# Start MongoDB
mongod --config /etc/mongod.conf &

#Wait for mongodb to start
sleep 5 &&

# Start your Node.js application
node server.js disableAD=true &

#Default command
bash
