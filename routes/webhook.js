// @ts-check
const DbAbstraction = require('../dbAbstraction');
const webhookUtils = require('./webhookUtils');
const router = require('express').Router();

const WEBHOOK_ID_IN_DB = "webhooks";
const METADATA_COLLECTION_NAME = "metaData";

/**
 * @route POST /subscribe
 * @description Endpoint for subscribing the webhook to the DG events.
 * @requestBody {
 *      eventType:  "ADD" | "MODIFY" | "DELETE"
 *      url: <your consumer webhook url>
 *      dataset: <dataset to subscribe to>
 * }
 * @returns {200} - Success message if the subscription is succesfull
 * @returns {400} - Error message if the request body is not proper.
 * @returns {500} - Error message for any unexpected server errors
 */
router.post('/subscribe', async(req, res, next) => {
    try {
        let request = req.body;
        if (!request) {
            return res.status(400).json({error: "invalid request"});
        }

        // Validate the incoming request body
        if (!webhookUtils.isValidSubscriptionMessage(request.eventType, request.url, request.dataset)) {
            return res.status(400).json({
                errorMsg: "Request body is not proper.",
                sampleRequestBody: {
                    eventType: webhookUtils.SUPPORTED_EVENT_TYPES.join(" | "),
                    url: "<your consumer webhook url>",
                    dataset: "dataset name that you want the subscription for"
                }
            })
        }
        let dsName = request.dataset;
        let url = request.url;
        let eventType = request.eventType;

        // Check if the given dataset exists.
        let dbAbstraction = new DbAbstraction();
        let dbExists = await dbAbstraction.checkIfDbExists(dsName);
        if (!dbExists) {
            return res.status(400).json({
                error: "Error occured during subscription",
                errorMsg: `Dataset ${dsName} doesn't exist in the db. Can't subscirbe to the events of non-existing dataset.`
            });
        }

        // Find the existing webhooks. If there isn't any, make an empty one before proceeding ahead.
        let webhooks = await dbAbstraction.find(dsName, METADATA_COLLECTION_NAME, { _id: WEBHOOK_ID_IN_DB }, {} );
        console.log(`${Date()} Existing Webhooks for dataset: ${dsName} is : ${JSON.stringify(webhooks)}`);
        let webhooksDetails = [];
        if (!webhooks.length) {
            console.log(`${Date()} No existing webhooks enabled for dataset: ${dsName}. Going to create one..`);
            let dbResponse = await dbAbstraction.update(dsName, METADATA_COLLECTION_NAME, { _id: WEBHOOK_ID_IN_DB }, {
                "webhooksDetails": []
            });
            if (dbResponse.modifiedCount == 0 && dbResponse.upsertedCount == 0) { //Nothing got updated
                console.log(`${Date()}: Couldn't make the intial webhooksDetails in the db`);
                return res.status(500).json({
                    error: "Error occured during subscription",
                    errorMsg: "Unable to update the subscription info in DB."
                })
            }
        } else {
            //Get the webhooksDetails with subscription
            webhooksDetails = webhooks[0].webhooksDetails;
        }

        let updatedWebhooksDetails = webhookUtils.getUpdatedWebhooksDetails(webhooksDetails, eventType, url, true);
        console.log(`${Date()} Updated WebhooksDetails for dataset: ${dsName} is : ${JSON.stringify(updatedWebhooksDetails)}`);

        // Persist the updated webhooksDetails in Db
        let dbResponse = await dbAbstraction.update(dsName, METADATA_COLLECTION_NAME, {_id: WEBHOOK_ID_IN_DB}, {
            "webhooksDetails": updatedWebhooksDetails
        })
        if (dbResponse.modifiedCount == 0 && dbResponse.upsertedCount == 0) { // Nothing got updated
            console.log(`${Date()}: Couldn't modify the updatedWebhooksDetails in the db`);
            return res.status(500).json({
                error: "Error occured during subscription",
                errorMsg: "Unable to update the subscription info in DB."
            })
        }
        console.log(`${Date()} Db response for updated webhooks details: ${dbResponse}`);

        //Cleanup the connection
        await dbAbstraction.destroy();

        //Send success response
        return res.status(200).json({
            message: `Successfully subscribed to webhook at : ${url} for event: ${eventType} on dataset: ${dsName}`
        })
    } catch(err) {
        console.log(`${Date()} caught error while subscribing the webhook. Err: ${err.stack}`);
        return res.status(400).json({ 
            error: "An unexpected error during subscription", 
            errorMsg: err.message,
            sampleRequestBody: {
                eventType: webhookUtils.SUPPORTED_EVENT_TYPES.join(" | "),
                url: "<your consumer webhook url>",
                dataset: "dataset name that you want the subscription for"
            }
        });
    }
});

// Route to unsubscribe
router.post('/unsubscribe', async(req, res, next) => {
    try {
        let request = req.body;
        if (!request) {
            return res.status(400).json({error: "invalid request"});
        }

        // Validate the incoming request body
        if (!webhookUtils.isValidSubscriptionMessage(request.eventType, request.url, request.dataset)) {
            return res.status(400).json({
                errorMsg: "Request body is not proper.",
                sampleRequestBody: {
                    eventType: webhookUtils.SUPPORTED_EVENT_TYPES.join(" | "),
                    url: "<your consumer webhook url>",
                    dataset: "dataset name that you want the subscription for"
                }
            })
        }
        let dsName = request.dataset;
        let url = request.url;
        let eventType = request.eventType;

        // Check if the given dataset exists.
        let dbAbstraction = new DbAbstraction();
        let dbExists = await dbAbstraction.checkIfDbExists(dsName);
        if (!dbExists) {
            return res.status(400).json({
                error: "Error occured during unsubscribing",
                errorMsg: `Dataset ${dsName} doesn't exist in the db. Can't unsubscribe to the events of non-existing dataset.`
            });
        }

        // Find the existing webhooks. If there isn't any, make an empty one before proceeding ahead.
        let webhooks = await dbAbstraction.find(dsName, METADATA_COLLECTION_NAME, { _id: WEBHOOK_ID_IN_DB }, {} );
        console.log(`${Date()} Existing Webhooks for dataset: ${dsName} is : ${JSON.stringify(webhooks)}`);
        let webhooksDetails = [];
        if (!webhooks.length) {
            return res.status(400).json({
                error: "Error occured during unsubscribing",
                errorMsg: `Dataset ${dsName} doesn't have any webhooks enabled right now.`
            })
        } else {
            //Get the webhooksDetails with subscription
            webhooksDetails = webhooks[0].webhooksDetails;
        }

        let updatedWebhooksDetails = webhookUtils.getUpdatedWebhooksDetails(webhooksDetails, eventType, url, false);
        console.log(`${Date()} Updated WebhooksDetails for dataset: ${dsName} is : ${JSON.stringify(updatedWebhooksDetails)}`);

        // Persist the updated webhooksDetails in Db
        let dbResponse = await dbAbstraction.update(dsName, METADATA_COLLECTION_NAME, {_id: WEBHOOK_ID_IN_DB}, {
            "webhooksDetails": updatedWebhooksDetails
        })
        if (dbResponse.modifiedCount == 0 && dbResponse.upsertedCount == 0) { // Nothing got updated
            console.log(`${Date()}: Couldn't modify the updatedWebhooksDetails in the db`);
            return res.status(500).json({
                error: "Error occured during unsubscribing",
                errorMsg: "Unable to update the webhooksDetails info in DB."
            })
        }
        console.log(`${Date()} Db response for updated webhooks details: ${dbResponse}`);

        //Cleanup the connection
        await dbAbstraction.destroy();

        //Send success response
        return res.status(200).json({
            message: `Successfully unsubscribed to webhook at : ${url} for event: ${eventType} on dataset: ${dsName}`
        })
    } catch(err) {
        console.log(`${Date()} caught error while unsubscribing the webhook. Err: ${err.stack}`);
        return res.status(400).json({ 
            error: "An unexpected error during unsubscribing", 
            errorMsg: err.message,
            sampleRequestBody: {
                eventType: webhookUtils.SUPPORTED_EVENT_TYPES.join(" | "),
                url: "<your consumer webhook url>",
                dataset: "dataset name that you want the subscription for"
            }
        });
    }
});

module.exports = router;