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
const MAX_PATS_PER_USER = 7;

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
 * Generate token data object with hash and metadata.
 * @param {string} name - User-friendly token name
 * @param {number} expiresInDays - Days until expiration (0 = never)
 * @returns {object} { fullToken, tokenData }
 */
function generateTokenData(name, expiresInDays) {
    const visiblePrefix = crypto.randomBytes(6).toString('hex');
    const secretPortion = crypto.randomBytes(20).toString('hex');
    const fullToken = `dgpat_${visiblePrefix}_${secretPortion}`;
    const tokenHash = crypto.createHash('sha256')
        .update(fullToken)
        .digest('hex');

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

    return { fullToken, tokenData, visiblePrefix };
}

/**
 * Generate a new Personal Access Token.
 * Token grants access to ALL datasets under the user's ACL (no dataset selection).
 * Stored once in _dg_metaData.accessTokens keyed by userId.
 *
 * @swagger
 * /api/pats/generate:
 *   post:
 *     summary: Generate a new Personal Access Token (PAT)
 *     description: Creates a new PAT for the authenticated user. The token grants access to all datasets under the user's ACL. The full token is shown only once upon creation.
 *     tags: [PAT]
 *     security:
 *       - cookieAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [name]
 *             properties:
 *               name:
 *                 type: string
 *                 description: User-friendly token name (max 100 characters)
 *                 example: "My API Token"
 *               expiresInDays:
 *                 type: number
 *                 description: Days until expiration (0 or omit for never expires)
 *                 example: 90
 *     responses:
 *       200:
 *         description: Token generated successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 token:
 *                   type: string
 *                   description: The full token (shown only once - copy it now!)
 *                   example: "dgpat_a1b2c3d4e5f6_0123456789abcdef01234567"
 *                 token_id:
 *                   type: string
 *                   description: Unique token identifier (UUID)
 *                 token_prefix:
 *                   type: string
 *                   description: Visible prefix for identifying the token
 *                   example: "dgpat_a1b2c3d4e5f6"
 *                 created_at:
 *                   type: string
 *                   format: date-time
 *                   description: Token creation timestamp
 *                 expires_at:
 *                   type: string
 *                   format: date-time
 *                   nullable: true
 *                   description: Token expiration timestamp (null if never expires)
 *                 scope:
 *                   type: string
 *                   description: Token scope
 *                   example: "All datasets (ACL)"
 *                 message:
 *                   type: string
 *                   description: Important reminder message
 *       400:
 *         description: Invalid request or maximum tokens reached
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 error:
 *                   type: string
 *                   example: "You have reached the maximum of 7 personal access token(s)."
 *       401:
 *         description: Unauthorized - authentication required
 *       500:
 *         description: Server error
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

        const userDoc = await getUserTokenDoc(dbAbstraction, userId);
        const existingTokens = (userDoc && userDoc.tokens) || [];
        if (existingTokens.length >= MAX_PATS_PER_USER) {
            return res.status(400).json({
                error: `You have reached the maximum of ${MAX_PATS_PER_USER} personal access token(s). Please revoke an existing token before creating a new one.`
            });
        }

        const { fullToken, tokenData, visiblePrefix } = generateTokenData(name, expiresInDays);

        logger.info(`Generated token hash: ${tokenData.token_hash.substring(0, 10)}... for user ${userId}`);

        const updatedTokens = [...existingTokens, tokenData];

        await dbAbstraction.update(
            PAT_DB,
            PAT_COLLECTION,
            { _id: userId },
            { tokens: updatedTokens }
        );

        logger.info(`Stored PAT for user ${userId} in ${PAT_DB}.${PAT_COLLECTION}`);

        res.json({
            token: fullToken,
            token_id: tokenData.token_id,
            token_prefix: `dgpat_${visiblePrefix}`,
            created_at: tokenData.created_at,
            expires_at: tokenData.expires_at,
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
 * 
 * @swagger
 * /api/pats:
 *   get:
 *     summary: List all Personal Access Tokens for the current user
 *     description: Returns a list of all PATs (active and expired) for the authenticated user, sorted by creation date (newest first).
 *     tags: [PAT]
 *     security:
 *       - cookieAuth: []
 *     responses:
 *       200:
 *         description: List of tokens retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 tokens:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       token_id:
 *                         type: string
 *                         description: Unique token identifier
 *                       name:
 *                         type: string
 *                         description: User-friendly token name
 *                       scopes:
 *                         type: array
 *                         items:
 *                           type: string
 *                         description: Token scopes
 *                       created_at:
 *                         type: string
 *                         format: date-time
 *                         description: Token creation timestamp
 *                       expires_at:
 *                         type: string
 *                         format: date-time
 *                         nullable: true
 *                         description: Token expiration timestamp
 *                       is_expired:
 *                         type: boolean
 *                         description: Whether the token has expired
 *                       dataset_name:
 *                         type: string
 *                         description: Dataset scope
 *                         example: "All datasets (ACL)"
 *                 user:
 *                   type: string
 *                   description: Current user ID
 *       401:
 *         description: Unauthorized - authentication required
 *       500:
 *         description: Server error
 * 
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
 * 
 * @swagger
 * /api/pats/{tokenId}:
 *   get:
 *     summary: Get details for a specific Personal Access Token
 *     description: Returns detailed information about a specific PAT identified by its token_id.
 *     tags: [PAT]
 *     security:
 *       - cookieAuth: []
 *     parameters:
 *       - in: path
 *         name: tokenId
 *         required: true
 *         schema:
 *           type: string
 *         description: The unique token identifier (UUID)
 *     responses:
 *       200:
 *         description: Token details retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 token:
 *                   type: object
 *                   properties:
 *                     token_id:
 *                       type: string
 *                       description: Unique token identifier
 *                     name:
 *                       type: string
 *                       description: User-friendly token name
 *                     scopes:
 *                       type: array
 *                       items:
 *                         type: string
 *                       description: Token scopes
 *                     created_at:
 *                       type: string
 *                       format: date-time
 *                       description: Token creation timestamp
 *                     expires_at:
 *                       type: string
 *                       format: date-time
 *                       nullable: true
 *                       description: Token expiration timestamp
 *                     is_expired:
 *                       type: boolean
 *                       description: Whether the token has expired
 *                 scope:
 *                   type: string
 *                   description: Dataset scope
 *                   example: "All datasets (ACL)"
 *       401:
 *         description: Unauthorized - authentication required
 *       404:
 *         description: Token not found
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 error:
 *                   type: string
 *                   example: "Token not found"
 *       500:
 *         description: Server error
 * 
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
 * 
 * @swagger
 * /api/pats/{tokenId}:
 *   delete:
 *     summary: Delete (revoke) a Personal Access Token
 *     description: Permanently revokes a PAT identified by its token_id. The token can no longer be used for authentication after deletion.
 *     tags: [PAT]
 *     security:
 *       - cookieAuth: []
 *     parameters:
 *       - in: path
 *         name: tokenId
 *         required: true
 *         schema:
 *           type: string
 *         description: The unique token identifier (UUID) to delete
 *     responses:
 *       200:
 *         description: Token deleted successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 message:
 *                   type: string
 *                   example: "Token deleted successfully"
 *                 token_id:
 *                   type: string
 *                   description: The deleted token's ID
 *       401:
 *         description: Unauthorized - authentication required
 *       404:
 *         description: Token not found or already deleted
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 error:
 *                   type: string
 *                   example: "Token not found or already deleted"
 *       500:
 *         description: Server error
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 error:
 *                   type: string
 *                   example: "Failed to delete token"
 *                 details:
 *                   type: string
 * 
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
