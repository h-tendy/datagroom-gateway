// @ts-nocheck
/**
 * userPrefs.js
 * 
 * Manages per-user preferences stored in the dedicated `_dg_user_prefs` MongoDB database.
 * Each user has one document in the `preferences` collection keyed by userId.
 * 
 * Current preference fields:
 *   pinnedDs {string[]}  - dataset names pinned to the top of the user's All-Datasets list
 */

const DbAbstraction = require('./dbAbstraction');
const logger = require('./logger');

const PREFS_DB = '_dg_user_prefs';
const PREFS_COLLECTION = 'preferences';

/**
 * Get the list of pinned dataset names for a user.
 * Returns an empty array if no preferences document exists yet (backward-compatible default).
 * 
 * @param {string} userId
 * @returns {Promise<string[]>}
 */
async function getPinnedDs(userId) {
    if (!userId) return [];
    const db = new DbAbstraction();
    const docs = await db.find(PREFS_DB, PREFS_COLLECTION, { _id: userId });
    if (docs && docs.length > 0 && Array.isArray(docs[0].pinnedDs)) {
        return docs[0].pinnedDs;
    }
    return [];
}

/**
 * Persist the updated list of pinned dataset names for a user.
 * Creates the preferences document if it does not yet exist (upsert).
 * 
 * @param {string} userId
 * @param {string[]} pinnedDsArray
 * @returns {Promise<void>}
 */
async function setPinnedDs(userId, pinnedDsArray) {
    if (!userId) throw new Error('userId is required');
    const db = new DbAbstraction();
    await db.update(PREFS_DB, PREFS_COLLECTION, { _id: userId }, { pinnedDs: pinnedDsArray });
}

module.exports = { getPinnedDs, setPinnedDs };
