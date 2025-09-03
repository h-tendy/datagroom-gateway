# Function to capture 'top' output 5 times at 1-second intervals and log it
log_top_snapshots() {
    echo "$(date '+%Y-%m-%d %H:%M:%S') Capturing 'top' output snapshots (5x, 1s interval)" 
    for i in $(seq 1 5); do
        if command -v top >/dev/null 2>&1; then
            echo "--- top snapshot $i --- $(date '+%Y-%m-%d %H:%M:%S') ---"
            top -b -n 1 2>&1
        else
            echo "top command not found on this system."
            break
        fi
        sleep 1
    done
    echo "$(date '+%Y-%m-%d %H:%M:%S') 'top' snapshots complete."
}
#!/bin/bash

# Cleanup function which stops the DG-gateway if the script is killed.
cleanup() {
    if [[ -n "$child_pid" ]]; then
        echo "$(date '+%Y-%m-%d %H:%M:%S') Caught termination signal. Killing DG-gateway (PID $child_pid)"
        kill "$child_pid" 2>/dev/null
    fi
    exit 0
}

trap cleanup SIGINT SIGTERM

while true; do
    # Start the DG-gateway
    nohup node --max_old_space_size=10240 ./server.js >> nohupGateway.log 2>&1 &
    child_pid=$!
    echo "$(date '+%Y-%m-%d %H:%M:%S') Started DG-gateway with PID $child_pid"
    # wait indefinitely until the process exits
    wait $child_pid

    # Capture 'top' output snapshots before log rotation
    log_top_snapshots

    echo "$(date '+%Y-%m-%d %H:%M:%S') DG-gateway (PID $child_pid) crashed. Checking for datagroom.log... and backing it up."
    # Backup the datagroom.log file if it exists
    if [ -f datagroom.log ]; then
        ts=$(date '+%Y%m%d_%H%M%S')
        mv datagroom.log datagroom.log.$child_pid.$ts
        echo "$(date '+%Y-%m-%d %H:%M:%S') datagroom.log rotated to datagroom.log.$child_pid.$ts"
    fi
    # Wait for 10 seconds before restarting the DG-gateway
    echo "$(date '+%Y-%m-%d %H:%M:%S') Restarting in 10 seconds..."
    sleep 10
done