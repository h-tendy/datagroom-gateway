const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const { v4: uuidv4 } = require('uuid');
const DbAbstraction = require('../dbAbstraction');
const logger = require('../logger');
const Utils = require('../utils');

const PAT_DB = '_dg_metaData';
const PAT_COLLECTION = 'accessTokens';

// Maximum number of active PATs allowed per user. Increase this value to allow more tokens.
const MAX_PATS_PER_USER = 1;

/**
 * Get list of dataset names the user has ACL access to.
 * Used only to validate the user has at least one accessible dataset before issuing a token.
 */
async function getDatasetsForUser(dbAbstraction, userId) {
    const dbs = await dbAbstraction.listDatabases();
    const names = Utils.getDbsExcludingSysDbs(dbs);
    const allowed = [];
    for (const dbName of names) {
        try {
            const aclConfig = await dbAbstraction.find(dbName, 'metaData', { _id: 'aclConfig' }, {});
            const config = aclConfig && aclConfig[0];
            if (!config || !config.accessCtrl) {
                allowed.push(dbName);
            } else if (config.acl && config.acl.includes(userId)) {
                allowed.push(dbName);
            }
        } catch (e) {
            logger.error(e, `Error checking ACL for dataset ${dbName}`);
        }
    }
    return allowed;
}

/**
 * Read the accessTokens document for a user from _dg_metaData.
 * Returns null if no document exists yet.
 * @param {DbAbstraction} dbAbstraction
 * @param {string} userId
 * @returns {Promise<object|null>}
 */
async function getUserTokenDoc(dbAbstraction, userId) {
    const docs = await dbAbstraction.find(PAT_DB, PAT_COLLECTION, { _id: userId }, {});
    return docs && docs.length > 0 ? docs[0] : null;
}

/**
 * Generate a new Personal Access Token.
 * Token grants access to ALL datasets under the user's ACL (no dataset selection).
 * Stored once in _dg_metaData.accessTokens keyed by userId.
 *
 * @route POST /api/pats/generate
 * @body {string} name - User-friendly token name
 * @body {number} expiresInDays - Days until expiration (0 = never)
 * @returns {object} Token data including full token (ONE TIME ONLY)
 */
router.post('/generate', async (req, res) => {
    try {
        const { name, expiresInDays } = req.body;
        const userId = req.user;

        if (!name || name.length > 100) {
            return res.status(400).json({
                error: 'Token name is required and must be less than 100 characters'
            });
        }

        const dbAbstraction = new DbAbstraction();
        const allowedDatasets = await getDatasetsForUser(dbAbstraction, userId);
        if (allowedDatasets.length === 0) {
            return res.status(400).json({
                error: 'You have no dataset access. Add yourself to at least one dataset ACL before creating a token.'
            });
        }

        const userDoc = await getUserTokenDoc(dbAbstraction, userId);
        const existingTokens = (userDoc && userDoc.tokens) || [];
        if (existingTokens.length >= MAX_PATS_PER_USER) {
            return res.status(400).json({
                error: `You have reached the maximum of ${MAX_PATS_PER_USER} personal access token(s). Please revoke an existing token before creating a new one.`
            });
        }

        const visiblePrefix = crypto.randomBytes(6).toString('hex');
        const secretPortion = crypto.randomBytes(20).toString('hex');
        const fullToken = `dgpat_${visiblePrefix}_${secretPortion}`;
        const tokenHash = crypto.createHash('sha256')
            .update(fullToken)
            .digest('hex');

        logger.info(`Generated token hash: ${tokenHash.substring(0, 10)}... for user ${userId}`);

        let expiresAt = null;
        if (expiresInDays && expiresInDays > 0) {
            expiresAt = new Date();
            expiresAt.setDate(expiresAt.getDate() + parseInt(expiresInDays));
        }

        const tokenData = {
            token_id: uuidv4(),
            name: name.trim(),
            token_hash: tokenHash,
            scopes: ['dg_access'],
            created_at: new Date(),
            expires_at: expiresAt
        };

        const updatedTokens = [...existingTokens, tokenData];

        if (!userDoc) {
            await dbAbstraction.insertOne(PAT_DB, PAT_COLLECTION, {
                _id: userId,
                tokens: updatedTokens
            });
        } else {
            await dbAbstraction.update(
                PAT_DB,
                PAT_COLLECTION,
                { _id: userId },
                { tokens: updatedTokens }
            );
        }

        logger.info(`Stored PAT for user ${userId} in ${PAT_DB}.${PAT_COLLECTION}`);

        res.json({
            token: fullToken,
            token_id: tokenData.token_id,
            token_prefix: `dgpat_${visiblePrefix}`,
            created_at: tokenData.created_at,
            expires_at: expiresAt,
            scope: 'All datasets (ACL)',
            message: 'IMPORTANT: Copy this token now. You will not be able to see it again!'
        });
    } catch (error) {
        logger.error(error, 'Error generating PAT');
        res.status(500).json({
            error: 'Failed to generate token',
            details: error.message
        });
    }
});

/**
 * List all tokens for current user.
 * @route GET /api/pats
 */
router.get('/', async (req, res) => {
    try {
        const userId = req.user;
        const dbAbstraction = new DbAbstraction();
        const userDoc = await getUserTokenDoc(dbAbstraction, userId);
        const tokens = (userDoc && userDoc.tokens) || [];

        const result = tokens
            .map(t => ({
                token_id: t.token_id,
                name: t.name,
                scopes: t.scopes,
                created_at: t.created_at,
                expires_at: t.expires_at,
                is_expired: t.expires_at && new Date(t.expires_at) < new Date(),
                dataset_name: 'All datasets (ACL)'
            }))
            .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

        res.json({ tokens: result, user: userId });
    } catch (error) {
        logger.error(error, 'Error listing PATs');
        res.status(500).json({
            error: 'Failed to list tokens',
            details: error.message
        });
    }
});

/**
 * Get details for a specific token by token_id.
 * @route GET /api/pats/:tokenId
 */
router.get('/:tokenId', async (req, res) => {
    try {
        const userId = req.user;
        const { tokenId } = req.params;
        const dbAbstraction = new DbAbstraction();
        const userDoc = await getUserTokenDoc(dbAbstraction, userId);
        const tokens = (userDoc && userDoc.tokens) || [];
        const token = tokens.find(t => t.token_id === tokenId);

        if (!token) {
            return res.status(404).json({ error: 'Token not found' });
        }

        res.json({
            token: {
                token_id: token.token_id,
                name: token.name,
                scopes: token.scopes,
                created_at: token.created_at,
                expires_at: token.expires_at,
                is_expired: token.expires_at && new Date(token.expires_at) < new Date()
            },
            scope: 'All datasets (ACL)'
        });
    } catch (error) {
        logger.error(error, 'Error getting PAT details');
        res.status(500).json({
            error: 'Failed to get token details',
            details: error.message
        });
    }
});

/**
 * Delete (revoke) a token by token_id.
 * @route DELETE /api/pats/:tokenId
 */
router.delete('/:tokenId', async (req, res) => {
    try {
        const userId = req.user;
        const { tokenId } = req.params;
        const dbAbstraction = new DbAbstraction();
        const userDoc = await getUserTokenDoc(dbAbstraction, userId);
        const tokens = (userDoc && userDoc.tokens) || [];
        const updatedTokens = tokens.filter(t => t.token_id !== tokenId);

        if (updatedTokens.length === tokens.length) {
            return res.status(404).json({ error: 'Token not found or already deleted' });
        }

        await dbAbstraction.update(
            PAT_DB,
            PAT_COLLECTION,
            { _id: userId },
            { tokens: updatedTokens }
        );

        logger.info(`Deleted PAT ${tokenId} for user ${userId}`);

        res.json({
            success: true,
            message: 'Token deleted successfully',
            token_id: tokenId
        });
    } catch (error) {
        logger.error(error, 'Error deleting PAT');
        res.status(500).json({
            error: 'Failed to delete token',
            details: error.message
        });
    }
});

module.exports = router;
