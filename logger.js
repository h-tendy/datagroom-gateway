const pino = require('pino');
const path = require('path');
const fs = require('fs');

//Define relative path to the logfile
const logFileName = 'datagroom.log';
const logFilePath = path.join(__dirname, logFileName);

const logDirectory = path.dirname(logFilePath);
if (!fs.existsSync(logDirectory)) {
    fs.mkdirSync(logDirectory, { recursive: true});
}

//Create a writablestream to logfile, 'a' for append
const dest = fs.createWriteStream(logFilePath, {flags: 'a'} );

// Custom log method to have a fallback for circular objects.
const customLogMethod = function (args, method) {
    let finalArgs = args;
    try {
        JSON.stringify(args);
    } catch (hookError) {
        // THIS IS THE CRITICAL PART FOR RESILIENCE: Catch errors within the hook itself
        console.error('Pino `logMethod` hook failed during argument processing:', hookError, 'Original args:', JSON.stringify(args));

        // Craft a safe set of arguments for Pino to log instead
        // This ensures the log still goes through, even if malformed
        let errorToLog = hookError instanceof Error ? hookError : new Error(`Hook processing error: ${hookError.message || hookError}`);
        // let messageToLog = `Pino logging call failed. Original call: ${args.map(a => typeof a === 'object' && a !== null ? `[${a.constructor.name} object]` : String(a)).join(', ')}`;
        let messageToLog = `Pino logging call failed`;
        
        // Ensure the error object is passed first, then the message, then any other relevant data.
        // We prioritize the hook's error and a diagnostic message.
        finalArgs = [errorToLog, messageToLog];
    }
    method.apply(this, finalArgs);
}

const logger = pino({
    level: process.env.NODE_ENV === 'production' ? 'info' : 'debug',
    hooks: {
        logMethod: customLogMethod
    },
    formatters: {
        level(label, number) {
            return { level: label };
        }
    },
    base: null, // Doesn't log hostname and pid everytime.
    timestamp: () => `,"time":"${new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })}"`
}, process.env.NODE_ENV === 'production' ? dest : process.stdout);


logger.info("info");
logger.fatal('this is fatal');
logger.error('error');
logger.warn('warn');
logger.debug('debug');
logger.trace('trace');
logger.silent('silent');

module.exports = logger;