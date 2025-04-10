// @ts-check
const { aclCheck } = require('../acl');
const DbAbstraction = require('../dbAbstraction');
const webhookUtils = require('./webhookUtils');
const router = require('express').Router();
const jwt = require('jsonwebtoken');
const Utils = require('../utils');

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
 * @returns {200 | 400 | 500}
 * 200 - Success message if the subscription is succesfull
 * 400 - Error message if the request body is not proper.
 * 500 - Error message for any unexpected server errors
 */
router.post('/subscribe', async(req, res, next) => {
    try {
        let request = req.body;
        const token = req.cookies.jwt;
        if (!request || !token) {
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

        // Get user from token and validate
        const decode = jwt.verify(token, Utils.jwtSecret);
        // @ts-ignore
        let dsUser = decode.user;

        if (!dsUser || typeof dsUser !== "string" || dsUser.trim() === '') {
            return res.status(403).json({
                error: `Couldn't determine the user making the request. Access denied.`
            })
        }

        // Check if the given dataset exists.
        let dbAbstraction = new DbAbstraction();
        let dbExists = await dbAbstraction.checkIfDbExists(dsName);
        if (!dbExists) {
            return res.status(400).json({
                error: "Error occured during subscription",
                errorMsg: `Dataset ${dsName} doesn't exist in the db. Can't subscirbe to the events of non-existing dataset.`
            });
        }

        //Check if the user has permission to view the dataset.
        let userAccessAllowed = await aclCheck(dsName, "default", dsUser, token);
        if (!userAccessAllowed) {
            return res.status(403).json({
                error: `${dsUser} doesn't have access to ${dsName}. Access denied. `
            })
        }

        // Find the existing webhooks. If there isn't any, make an empty one before proceeding ahead.
        let webhooks = await dbAbstraction.find(dsName, METADATA_COLLECTION_NAME, { _id: WEBHOOK_ID_IN_DB }, {} );
        console.log(`${Date()} Existing Webhooks for dataset: ${dsName} is : ${JSON.stringify(webhooks)}`);
        let events = {};
        if (!webhooks.length) {
            console.log(`${Date()} No existing webhooks enabled for dataset: ${dsName}. Going to create one..`);
            let dbResponse = await dbAbstraction.update(dsName, METADATA_COLLECTION_NAME, { _id: WEBHOOK_ID_IN_DB }, {
                "events": {}
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
            events = webhooks[0].events;
        }

        let updatedEvents = webhookUtils.getUpdatedEvents(events, eventType, dsUser, url, true);
        console.log(`${Date()} Updated events for dataset: ${dsName} is : ${JSON.stringify(updatedEvents)}`);

        // Persist the updated webhooksDetails in Db
        let dbResponse = await dbAbstraction.update(dsName, METADATA_COLLECTION_NAME, {_id: WEBHOOK_ID_IN_DB}, {
            "events": updatedEvents
        })
        if (dbResponse.modifiedCount == 0 && dbResponse.upsertedCount == 0) { // Nothing got updated
            console.log(`${Date()}: Couldn't modify the updated events in the db`);
            return res.status(500).json({
                error: "Error occured during subscription",
                errorMsg: "Unable to update the subscription info in DB."
            })
        }
        console.log(`${Date()} Db response for updated events: ${dbResponse}`);

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
        const token = req.cookies.jwt;
        if (!request || !token) {
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
        
        // Get user from token and validate
        const decode = jwt.verify(token, Utils.jwtSecret);
        // @ts-ignore
        let dsUser = decode.user;

        if (!dsUser || typeof dsUser !== "string" || dsUser.trim() === '') {
            return res.status(403).json({
                error: `Couldn't determine the user making the request. Access denied.`
            })
        }

        // Check if the given dataset exists.
        let dbAbstraction = new DbAbstraction();
        let dbExists = await dbAbstraction.checkIfDbExists(dsName);
        if (!dbExists) {
            return res.status(400).json({
                error: "Error occured during unsubscribing",
                errorMsg: `Dataset ${dsName} doesn't exist in the db. Can't unsubscribe to the events of non-existing dataset.`
            });
        }

        //Check if the user has permission to view the dataset.
        let userAccessAllowed = await aclCheck(dsName, "default", dsUser, token);
        if (!userAccessAllowed) {
            return res.status(403).json({
                error: `${dsUser} doesn't have access to ${dsName}. Access denied.`
            })
        }

        // Find the existing webhooks. If there isn't any, make an empty one before proceeding ahead.
        let webhooks = await dbAbstraction.find(dsName, METADATA_COLLECTION_NAME, { _id: WEBHOOK_ID_IN_DB }, {} );
        console.log(`${Date()} Existing Webhooks for dataset: ${dsName} is : ${JSON.stringify(webhooks)}`);
        let events = {};
        if (!webhooks.length) {
            return res.status(400).json({
                error: "Error occured during unsubscribing",
                errorMsg: `Dataset ${dsName} doesn't have any webhooks enabled right now.`
            })
        } else {
            //Get the webhooksDetails with subscription
            events = webhooks[0].events;
        }

        let updatedEvents = webhookUtils.getUpdatedEvents(events, eventType, dsUser, url, false);
        console.log(`${Date()} Updated events for dataset: ${dsName} is : ${JSON.stringify(updatedEvents)}`);

        // Persist the updated webhooksDetails in Db
        let dbResponse = await dbAbstraction.update(dsName, METADATA_COLLECTION_NAME, {_id: WEBHOOK_ID_IN_DB}, {
            "events": updatedEvents
        })
        if (dbResponse.modifiedCount == 0 && dbResponse.upsertedCount == 0) { // Nothing got updated
            console.log(`${Date()}: Couldn't modify the updated events in the db`);
            return res.status(500).json({
                error: "Error occured during unsubscribing",
                errorMsg: "Unable to update the webhook details info in DB."
            })
        }
        console.log(`${Date()} Db response for updated events: ${dbResponse}`);

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