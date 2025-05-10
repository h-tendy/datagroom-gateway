// @ts-check
const SUPPORTED_EVENT_TYPES = ["ADD", "MODIFY", "DELETE"];

/**
 * @param {string} eventType
 * @param {string} url
 * @param {string} dataset
 * @returns {[Boolean, Error | null]} 
 * Returns array containing :-
 * - True if everything is valid, false if anyone is invalid.
 * - Error accompanies the reason why it is invalid.
 */
function isValidSubscriptionMessage(eventType, url, dataset) {
    let [isValidEventType, eventTypeError] = isValidEventTypeInRequest(eventType);
    if (eventTypeError) {
        return [false, eventTypeError];
    }
    let [isValidUrl, urlError] = isUrlPresentInRequest(url);
    if (urlError) {
        return [false, urlError];
    }
    let [isValidDataset, datasetError] = isDataSetPresentInRequest(dataset);
    if (datasetError) {
        return [false, datasetError];
    }
    return [true, null];
}

/**
 * @description Checks if the evenType is one of the supported event types
 * @param {String} eventType 
 * @returns {[Boolean, Error | null]} 
 * An array containing:-
 * - true if the eventType is valid, false if eventType is invalid
 * - Error is also sent when the eventType is invalid.
 */
function isValidEventTypeInRequest(eventType) {
    if (!eventType || typeof eventType !== "string" || eventType.trim() === '' || !SUPPORTED_EVENT_TYPES.includes(eventType)) {
        return [false, new Error(`eventType is not proper. eventType should be one of: ${SUPPORTED_EVENT_TYPES.join(" | ")}`)]
    }
    return [true, null];
}

/**
 * @description Checks the url is present or not
 * @param {String} url 
 * @returns {[Boolean, Error | null]} 
 * An array containing:-
 * - true if the url is valid, false if url is invalid
 * - Error is also sent when the url is invalid.
 */
function isUrlPresentInRequest(url) {
    if (!url || typeof url !== "string" || url.trim() === '') {
        return [false, new Error(`url is not proper. url should be non-empty string`)];
    }
    return [true, null];
}

/**
 * @description Checks the dataset is present or not
 * @param {String} dataset 
 * @returns {[Boolean, Error | null]} 
 * An array containing:-
 * - true if the dataset name is valid, false if dataset name is invalid
 * - Error is also sent when the dataset name is invalid.
 */
function isDataSetPresentInRequest(dataset) {
    if (!dataset || typeof dataset !== "string" || dataset.trim() === '') {
        return [false, new Error(`dataset name is not proper. dataset should be a non-empty string`)];
    }
    return [true, null];
}

/**
 * @typedef {object} Subscriber
 * @property {string} username
 * @property {string} url
 */
/**
 * 
 * @param {Object.<String, Subscriber[]>} events The persisted object containing all the events details
 * @param {string} eventType The event type to subscribe to or unsubscribe from
 * @param {string} username The username of the caller
 * @param {string} url The webhook consumer url
 * @param {boolean} subscribe A falg indicating whether to subscribe (true) or unsubscribe (false)
 * @returns {[Object.<string, Subscriber[]> | null, Error | null]}
 * - Return updated object
 * - Return error in case when unsubscribing not subscribed thing or subscribing again with same user and url
 */
function getUpdatedEvents(events, eventType, username, url, subscribe) {
    // Create a deep copy of the events to avoid unintended mutation
    let updatedEvents = JSON.parse(JSON.stringify(events));

    if (subscribe) {
        //Subscription logic
        if (!updatedEvents[eventType]) {
            // If the event type doesn't exist, create a new entry
            updatedEvents[eventType] = [{username, url}];
        } else {
            //If the event type exists, add the subscriber if not already present
            const isSubscriberPresent = updatedEvents[eventType].some(
                (sub) => sub.username === username && sub.url === url
            );

            if (isSubscriberPresent) {
                return [null, new Error(`${username} is already subscribed to event ${eventType} with hook ${url}`)];
            } else {
                updatedEvents[eventType].push({username, url});
            }
        }
    } else {
        // Unsubscription logic
        if (!updatedEvents[eventType]) {
            //If the eventType is not in events, return error
            return [null, new Error(`No subscriber present for event type: ${eventType}.`)];
        } else {
            const initialHooksCount = updatedEvents[eventType].length;
            updatedEvents[eventType] = updatedEvents[eventType].filter(
                (sub) => !(sub.username === username && sub.url === url)
            );

            if (updatedEvents[eventType].length === initialHooksCount) {
                //If no subscriber was removed, return an error
                return [null, new Error(`${username} is not subscribed with url ${url} to ${eventType} event type yet. Can't unsubscribe.`)];
            }
            
            if (updatedEvents[eventType].length === 0) {
                delete updatedEvents[eventType];
            }
        }
    }

    return [updatedEvents, null];
}

module.exports ={
    isValidSubscriptionMessage,
    SUPPORTED_EVENT_TYPES,
    getUpdatedEvents
}