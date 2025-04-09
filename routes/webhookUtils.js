const SUPPORTED_EVENT_TYPES = ["ADD", "MODIFY", "DELETE"];

function isValidSubscriptionMessage(eventType, url, dataset) {
    try {
        return isValidEventTypeInRequest(eventType) && isUrlPresentInRequest(url) && isDataSetPresentInRequest(dataset)
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
 * Based on subscribe or unsubscribe, this function updates or removes the url from the webhooksDetails
 * and returns the updated webhooksDetails
 * @param {Array<{eventType: String, urls: Array<String>}>} webhooksDetails 
 * @param {String} eventType 
 * @param {String} url 
 * @param {boolean} subscribe 
 * @returns {Object}
 */
function getUpdatedWebhooksDetails(webhooksDetails, eventType, url, subscribe) {
    if (!Array.isArray(webhooksDetails)) {
        console.log(`${Date()}: webhooksDetails must be an array`);
        throw new Error("webhooksDetails must be an array.");
    }

    let updatedWebhooksDetails = {};
    let eventTypeFound = false;
    updatedWebhooksDetails = webhooksDetails.map(item => {
        if (item.eventType === eventType) {
            eventTypeFound = true;
            let copyOfUrls = [...item.urls];

            if (subscribe) {
                // Subscribe: Add URL if not already preset
                if (!copyOfUrls.includes(url)) {
                    copyOfUrls.push(url);
                } else {
                    throw new Error(`Provided url: ${url} already is subscribed for the eventType :${eventType}`);
                }
            } else {
                // Unsubscribe: Remove URL if present
                let urlIndex = copyOfUrls.indexOf(url);
                if (urlIndex > -1) {
                    copyOfUrls.splice(urlIndex, 1);
                } else {
                    throw new Error(`Provided url: ${url} is not subscribed for the eventType: ${eventType}`);
                }
            }
            return {...item, urls: copyOfUrls}; //Return updated object.
        }
        return item;
    });
    
    //If eventType not found then first time this eventType has come, we need to make a new entry
    if (subscribe && !eventTypeFound) {
        updatedWebhooksDetails.push({
            eventType: eventType,
            urls: [url]
        })
    }

    if (!subscribe && !eventTypeFound) {
        console.log(`${Date()} Provided eventType: ${eventType} is not subscribed yet.`);
        throw new Error("Can't unsubscribe for the event which is not subscribed yet.");
    }

    return updatedWebhooksDetails;
}

module.exports ={
    isValidSubscriptionMessage,
    SUPPORTED_EVENT_TYPES,
    getUpdatedWebhooksDetails
}