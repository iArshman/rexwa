import logger from '../core/logger.js';
import { jidNormalizer } from '@whiskeysockets/baileys'; // Declare jidNormalizer import

/**
 * LID (Likely Interesting Data) Contact Resolver
 * Handles proper contact name resolution for both saved contacts and PN/LID users
 * 
 * In newer WhatsApp versions, contacts use LID (a unique identifier)
 * This resolver ensures contacts display saved names or phone numbers properly
 */
export class ContactResolver {
    constructor(bot) {
        this.bot = bot;
        this.contactCache = new Map();
    }

    /**
     * Get the proper contact name for display
     * Priority: SavedName > PushName > Phone Number > JID
     */
    getContactName(jid, msg = null) {
        try {
            if (!jid) return 'Unknown';

            // Check cache first
            const cacheKey = this.normalizeJid(jid);
            if (this.contactCache.has(cacheKey)) {
                return this.contactCache.get(cacheKey);
            }

            // 1. Try saved contact name from store
            const contact = this.bot.store?.contacts?.[cacheKey];
            if (contact?.name) {
                this.contactCache.set(cacheKey, contact.name);
                return contact.name;
            }

            // 2. Try push name from message
            if (msg?.pushName) {
                this.contactCache.set(cacheKey, msg.pushName);
                return msg.pushName;
            }

            // 3. Try notify (saved contact name) from message
            if (msg?.notify) {
                this.contactCache.set(cacheKey, msg.notify);
                return msg.notify;
            }

            // 4. Extract phone number from JID
            const phoneNumber = this.extractPhoneFromJid(jid);
            if (phoneNumber) {
                this.contactCache.set(cacheKey, phoneNumber);
                return phoneNumber;
            }

            // Fallback
            this.contactCache.set(cacheKey, jid);
            return jid;
        } catch (error) {
            logger.error(`Error resolving contact name for ${jid}:`, error);
            return jid || 'Unknown';
        }
    }

    /**
     * Get full contact info including LID and metadata
     */
    getContactInfo(jid, msg = null) {
        try {
            const normalizedJid = this.normalizeJid(jid);
            const contact = this.bot.store?.contacts?.[normalizedJid] || {};
            
            return {
                jid: normalizedJid,
                name: this.getContactName(jid, msg),
                pushName: msg?.pushName || contact.name || null,
                notify: msg?.notify || contact.notify || null,
                isGroup: normalizedJid.includes('@g.us'),
                isLid: this.isLidJid(jid),
                phoneNumber: this.extractPhoneFromJid(jid),
                metadata: contact
            };
        } catch (error) {
            logger.error(`Error getting contact info for ${jid}:`, error);
            return {
                jid: this.normalizeJid(jid),
                name: 'Unknown',
                isGroup: jid?.includes('@g.us') || false,
                isLid: this.isLidJid(jid),
                phoneNumber: this.extractPhoneFromJid(jid)
            };
        }
    }

    /**
     * Normalize JID to standard format
     * Handles both old and new format JIDs
     */
    normalizeJid(jid) {
        if (!jid) return '';
        
        try {
            // Normalize JID to standard format
            const cleanJid = jid
                .replace(/[^0-9@.-]/g, '')
                .toLowerCase();
            
            if (!cleanJid.includes('@')) {
                return `${cleanJid}@s.whatsapp.net`;
            }
            return cleanJid;
        } catch (error) {
            logger.debug(`Error normalizing JID ${jid}:`, error);
            return jid.toLowerCase();
        }
    }

    /**
     * Extract phone number from JID
     * Works with both phone@s.whatsapp.net and new LID formats
     */
    extractPhoneFromJid(jid) {
        try {
            if (!jid) return null;

            // Handle group JIDs
            if (jid.includes('@g.us')) {
                return null;
            }

            // Extract phone number (digits only)
            const matches = jid.match(/(\d+)@/);
            if (matches && matches[1]) {
                return matches[1];
            }

            // Try extracting from full JID
            const phoneMatches = jid.match(/(\d{1,15})/);
            if (phoneMatches && phoneMatches[1]) {
                return phoneMatches[1];
            }

            return null;
        } catch (error) {
            logger.debug(`Error extracting phone from JID ${jid}:`, error);
            return null;
        }
    }

    /**
     * Check if JID is an LID (new format) or old PN format
     * LIDs typically have different format than phone numbers
     */
    isLidJid(jid) {
        if (!jid) return false;
        
        try {
            const phoneMatch = /(\d+)@/.exec(jid);
            if (phoneMatch) {
                const number = phoneMatch[1];
                // Phone numbers are typically 7-15 digits
                // LIDs can be very long or have different format
                return number.length > 15 || /[a-f0-9]{32,}/i.test(number);
            }
            return false;
        } catch (error) {
            return false;
        }
    }

    /**
     * Get or fetch contact from store
     */
    async fetchContact(jid) {
        try {
            const normalizedJid = this.normalizeJid(jid);
            
            // Try to get from store first
            if (this.bot.store?.contacts?.[normalizedJid]) {
                return this.bot.store.contacts[normalizedJid];
            }

            // Try to fetch from WhatsApp if socket is available
            if (this.bot.sock?.fetchPrivacySettings) {
                // Some versions allow fetching contact metadata
                logger.debug(`Attempting to fetch contact metadata for ${normalizedJid}`);
            }

            return null;
        } catch (error) {
            logger.error(`Error fetching contact ${jid}:`, error);
            return null;
        }
    }

    /**
     * Update contact cache with new info
     */
    updateContact(jid, contactData) {
        try {
            const normalizedJid = this.normalizeJid(jid);
            const name = contactData.name || contactData.notify || contactData.pushName;
            
            if (name) {
                this.contactCache.set(normalizedJid, name);
            }

            // Also update store if available
            if (this.bot.store?.contacts) {
                this.bot.store.contacts[normalizedJid] = {
                    ...this.bot.store.contacts[normalizedJid],
                    ...contactData
                };
            }
        } catch (error) {
            logger.error(`Error updating contact ${jid}:`, error);
        }
    }

    /**
     * Resolve JID to get both LID and PN mapping
     */
    async resolveJid(jid) {
        try {
            const store = this.bot?.sock?.signalRepository?.lidMapping;
            
            if (!store) {
                const phone = this.extractPhoneFromJid(jid);
                return { lid: null, pn: jid, phone: phone || jid.split('@')[0] };
            }
            
            if (jid.includes('@lid')) {
                // JID is a LID, try to get PN
                logger.debug(`Resolving LID to PN: ${jid}`);
                const pnJid = await store.getPNForLID?.(jid);
                
                if (pnJid) {
                    const phone = this.extractPhoneFromJid(pnJid);
                    logger.info(`Resolved LID ${jid} → PN ${pnJid}`);
                    return { lid: jid, pn: pnJid, phone: phone || pnJid.split('@')[0] };
                } else {
                    const phone = this.extractPhoneFromJid(jid);
                    return { lid: jid, pn: null, phone: phone || jid.split('@')[0] };
                }
            } else {
                // JID is a PN, try to get LID
                const phone = this.extractPhoneFromJid(jid);
                logger.debug(`Resolving PN to LID: ${jid}`);
                const lidJid = await store.getLIDForPN?.(jid);
                
                if (lidJid) {
                    logger.info(`Resolved PN ${jid} → LID ${lidJid}`);
                    return { lid: lidJid, pn: jid, phone: phone || jid.split('@')[0] };
                } else {
                    return { lid: null, pn: jid, phone: phone || jid.split('@')[0] };
                }
            }
        } catch (error) {
            logger.error(`Error resolving JID ${jid}:`, error);
            const phone = this.extractPhoneFromJid(jid);
            if (jid.includes('@lid')) {
                return { lid: jid, pn: null, phone: phone || jid.split('@')[0] };
            } else {
                return { lid: null, pn: jid, phone: phone || jid.split('@')[0] };
            }
        }
    }

    /**
     * Clear contact cache (for memory management)
     */
    clearCache() {
        this.contactCache.clear();
    }

    /**
     * Get cache stats
     */
    getCacheStats() {
        return {
            cachedContacts: this.contactCache.size,
            memoryUsage: process.memoryUsage()
        };
    }
}

export default ContactResolver;
