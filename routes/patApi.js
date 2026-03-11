const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const { v4: uuidv4 } = require('uuid');
const DbAbstraction = require('../dbAbstraction');
const logger = require('../logger');

const sysDbs = ['admin', 'config', 'local'];

/**
 * Get list of dataset names the user has ACL access to
 */
async function getDatasetsForUser(dbAbstraction, userId) {
    const dbs = await dbAbstraction.listDatabases();
    const names = (dbs || []).map(d => d.name).filter(n => !sysDbs.includes(n));
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
 * Generate a new Personal Access Token.
 * Token grants access to ALL datasets under the user's ACL (no dataset selection).
 *
 * @route POST /api/pats/generate
 * @body {string} name - User-friendly token name
 * @body {number} expiresInDays - Days until expiration (0 = never)
 * @returns {object} Token data including full token (ONE TIME ONLY)
 */
router.post('/generate', async (req, res) => {
    try {
        // Only name and expiresInDays are used. datasetName is NOT required; token grants access to all datasets under user's ACL.
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

        const visiblePrefix = crypto.randomBytes(6).toString('hex');
        const secretPortion = crypto.randomBytes(20).toString('hex');
        const fullToken = `dgpat_${visiblePrefix}_${secretPortion}`;
        const tokenHash = crypto.createHash('sha256')
            .update(fullToken)
            .digest('hex');

        logger.info(`Generated token hash: ${tokenHash.substring(0, 10)}... for user ${userId} (all datasets)`);

        let expiresAt = null;
        if (expiresInDays && expiresInDays > 0) {
            expiresAt = new Date();
            expiresAt.setDate(expiresAt.getDate() + parseInt(expiresInDays));
        }

        const tokenData = {
            token_id: uuidv4(),
            name: name.trim(),
            token_hash: tokenHash,
            scopes: ['mcp_access'],
            created_at: new Date(),
            expires_at: expiresAt
        };

        for (const datasetName of allowedDatasets) {
            let patsDoc = await dbAbstraction.find(
                datasetName,
                'metaData',
                { _id: 'dg_pats' },
                {}
            );
            if (!patsDoc || patsDoc.length === 0) {
                await dbAbstraction.insertOne(datasetName, 'metaData', {
                    _id: 'dg_pats',
                    users: {
                        [userId]: { tokens: [tokenData] }
                    }
                });
            } else {
                const currentPats = patsDoc[0];
                if (!currentPats.users) currentPats.users = {};
                if (!currentPats.users[userId]) currentPats.users[userId] = { tokens: [] };
                currentPats.users[userId].tokens.push(tokenData);
                await dbAbstraction.update(
                    datasetName,
                    'metaData',
                    { _id: 'dg_pats' },
                    { users: currentPats.users }
                );
            }
        }

        logger.info(`Added PAT for user ${userId} to ${allowedDatasets.length} dataset(s)`);

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
 * List all tokens for current user (deduped by token_id; one token = all datasets)
 * @route GET /api/pats
 */
router.get('/', async (req, res) => {
    try {
        const userId = req.user;
        const dbAbstraction = new DbAbstraction();
        const dbs = await dbAbstraction.listDatabases();
        const databases = (dbs || []).map(d => d.name).filter(name => !sysDbs.includes(name));
        const seen = new Set();
        const allTokens = [];

        for (const dbName of databases) {
            try {
                const patsDoc = await dbAbstraction.find(
                    dbName,
                    'metaData',
                    { _id: 'dg_pats' },
                    {}
                );
                if (patsDoc && patsDoc.length > 0 && patsDoc[0].users && patsDoc[0].users[userId]) {
                    const tokens = patsDoc[0].users[userId].tokens || [];
                    tokens.forEach(t => {
                        if (seen.has(t.token_id)) return;
                        seen.add(t.token_id);
                        allTokens.push({
                            token_id: t.token_id,
                            name: t.name,
                            scopes: t.scopes,
                            created_at: t.created_at,
                            expires_at: t.expires_at,
                            is_expired: t.expires_at && new Date(t.expires_at) < new Date(),
                            dataset_name: 'All datasets (ACL)'
                        });
                    });
                }
            } catch (e) {
                logger.error(e, `Error checking PATs in dataset ${dbName}`);
            }
        }

        allTokens.sort((a, b) =>
            new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
        );

        res.json({
            tokens: allTokens,
            user: userId
        });
    } catch (error) {
        logger.error(error, 'Error listing all PATs');
        res.status(500).json({
            error: 'Failed to list tokens',
            details: error.message
        });
    }
});

/**
 * Get details for a specific token (by token_id only)
 * @route GET /api/pats/:tokenId
 */
router.get('/:tokenId', async (req, res) => {
    try {
        const userId = req.user;
        const { tokenId } = req.params;
        const dbAbstraction = new DbAbstraction();
        const dbs = await dbAbstraction.listDatabases();
        const databases = (dbs || []).map(d => d.name).filter(name => !sysDbs.includes(name));

        for (const dbName of databases) {
            try {
                const patsDoc = await dbAbstraction.find(
                    dbName,
                    'metaData',
                    { _id: 'dg_pats' },
                    {}
                );
                if (!patsDoc || !patsDoc[0].users || !patsDoc[0].users[userId]) continue;
                const tokens = patsDoc[0].users[userId].tokens || [];
                const token = tokens.find(t => t.token_id === tokenId);
                if (token) {
                    return res.json({
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
                }
            } catch (e) {
                logger.error(e, `Error getting PAT in dataset ${dbName}`);
            }
        }

        return res.status(404).json({ error: 'Token not found' });
    } catch (error) {
        logger.error(error, 'Error getting PAT details');
        res.status(500).json({
            error: 'Failed to get token details',
            details: error.message
        });
    }
});

/**
 * Delete (revoke) a token from all datasets
 * @route DELETE /api/pats/:tokenId
 */
router.delete('/:tokenId', async (req, res) => {
    try {
        const userId = req.user;
        const { tokenId } = req.params;
        const dbAbstraction = new DbAbstraction();
        const dbs = await dbAbstraction.listDatabases();
        const databases = (dbs || []).map(d => d.name).filter(name => !sysDbs.includes(name));
        let removed = false;

        for (const dbName of databases) {
            try {
                const patsDoc = await dbAbstraction.find(
                    dbName,
                    'metaData',
                    { _id: 'dg_pats' },
                    {}
                );
                if (!patsDoc || patsDoc.length === 0 || !patsDoc[0].users || !patsDoc[0].users[userId]) continue;
                const currentPats = patsDoc[0];
                const tokens = currentPats.users[userId].tokens || [];
                const updatedTokens = tokens.filter(t => t.token_id !== tokenId);
                if (updatedTokens.length === tokens.length) continue;
                removed = true;
                currentPats.users[userId].tokens = updatedTokens;
                await dbAbstraction.update(
                    dbName,
                    'metaData',
                    { _id: 'dg_pats' },
                    { users: currentPats.users }
                );
            } catch (e) {
                logger.error(e, `Error deleting PAT in dataset ${dbName}`);
            }
        }

        if (!removed) {
            return res.status(404).json({ error: 'Token not found or already deleted' });
        }

        logger.info(`Deleted PAT ${tokenId} for user ${userId} from all datasets`);

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
