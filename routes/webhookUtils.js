// @ts-check
const SUPPORTED_EVENT_TYPES = ["ADD", "MODIFY", "DELETE"];

/**
 * @param {string} eventType
 * @param {string} url
 * @param {string} dataset
 */
function isValidSubscriptionMessage(eventType, url, dataset) {
    try {
        return isValidEventTypeInRequest(eventType) && isUrlPresentInRequest(url) 
            && isDataSetPresentInRequest(dataset);
    } catch (err) {
        console.log(`${Date()}: Caught error in isValidSubscriptionMessage for eventType: ${eventType}, url: ${url}, dataset:${dataset}`);
        throw err;
    }
}

/**
 * @description Checks if the evenType is one of the supported event types
 * @param {String} eventType 
 * @returns {true} when eventType is one of SUPPORTED_EVENT_TYPES
 * @returns {false} when eventType is not in the SUPPORTED_EVENT_TYPES
 */
function isValidEventTypeInRequest(eventType) {
    if (!eventType || typeof eventType !== "string" || eventType.trim() === '' || !SUPPORTED_EVENT_TYPES.includes(eventType)) {
        throw new Error(`eventType is not proper. eventType should be one of: ${SUPPORTED_EVENT_TYPES.join(" | ")}`);
    }
    return true;
}

/**
 * @description Checks the url is present or not
 * @param {String} url 
 * @returns {boolean}
 */
function isUrlPresentInRequest(url) {
    if (!url || typeof url !== "string" || url.trim() === '') {
        throw new Error(`url is not proper. url should be non-empty string`);
    }
    return true;
}

/**
 * @description Checks the dataset is present or not
 * @param {String} dataset 
 * @returns {boolean}
 */
function isDataSetPresentInRequest(dataset) {
    if (!dataset || typeof dataset !== "string" || dataset.trim() === '') {
        throw new Error(`dataset name is not proper. dataset should be a non-empty string`);
    }
    return true;
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
 * @returns {Object.<string, Subscriber[]>} The updated events object
 * @throws {Error} If unsubscribing from a non-existent event type
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
                throw new Error(`${username} is already subscribed to event ${eventType} with hook ${url}`);
            } else {
                updatedEvents[eventType].push({username, url});
            }
        }
    } else {
        // Unsubscription logic
        if (!updatedEvents[eventType]) {
            //If the eventType is not in events, throw error
            throw new Error(`No subscriber present for event type: ${eventType}.`);
        } else {
            const initialHooksCount = updatedEvents[eventType].length;
            updatedEvents[eventType] = updatedEvents[eventType].filter(
                (sub) => !(sub.username === username && sub.url === url)
            );

            if (updatedEvents[eventType].length === initialHooksCount) {
                //If no subscriber was removed, throw an error
                throw new Error(`${username} is not subscribed with url ${url} to ${eventType} event type yet. Can't unsubscribe.`);
            }
            
            if (updatedEvents[eventType].length === 0) {
                delete updatedEvents[eventType];
            }
        }
    }

    return updatedEvents;
}

module.exports ={
    isValidSubscriptionMessage,
    SUPPORTED_EVENT_TYPES,
    getUpdatedEvents
}