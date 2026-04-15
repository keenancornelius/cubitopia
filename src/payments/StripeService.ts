/**
 * StripeService — Handles Stripe Checkout integration for tribe skin purchases.
 * Lazy-loads Stripe.js and manages cosmetic (tribe) payment flow.
 *
 * Design:
 * - Publishable key from env var: VITE_STRIPE_PUBLISHABLE_KEY
 * - Lazy initialization: Stripe.js only loaded on first call
 * - LocalStorage persistence: unlocked tribes survive page reload
 * - Free starter: 'fantasy' (Ironveil) always unlocked
 * - Price mapping: tribeId → Stripe price ID (placeholders for demo)
 */

import type { TribeId } from '../game/TribeConfig';

interface StripeRedirectResult {
  error?: { message: string };
}

interface StripeInstance {
  redirectToCheckout(options: { sessionId: string }): Promise<StripeRedirectResult>;
}

declare global {
  interface Window {
    Stripe?: (publishableKey: string) => StripeInstance;
  }
}

/**
 * Map of tribe ID to Stripe Price ID.
 * These are placeholder IDs — update with real Stripe price IDs when setting up monetization.
 * Format: price_XXX (from Stripe Dashboard).
 */
const TRIBE_PRICE_MAP: Record<TribeId, string> = {
  fantasy: 'price_free_starter',      // Always free
  metal: 'price_wildborne_899',        // $8.99
  orchestral: 'price_arcanists_899',   // $8.99
  celtic: 'price_tidecallers_899',     // $8.99
  electronic: 'price_forgeborn_899',   // $8.99
  hiphop: 'price_sandstriders_899',    // $8.99
  lofi: 'price_mistwalkers_899',       // $8.99
  oldies: 'price_embercrown_899',      // $8.99
  alternative: 'price_voidtouched_899', // $8.99
};

/**
 * Storage key for unlocked tribes (comma-separated list of tribeIds).
 */
const STORAGE_KEY = 'cubitopia_unlocked_tribes';

/**
 * StripeService: Singleton for Stripe Checkout integration.
 * Usage:
 *   const service = StripeService.getInstance();
 *   await service.init();
 *   if (!service.isUnlocked('metal')) {
 *     await service.purchaseTribeSkin('metal', TRIBE_PRICE_MAP.metal);
 *   }
 */
class StripeService {
  private static instance: StripeService | null = null;
  private stripeInstance: StripeInstance | null = null;
  private publishableKey: string;
  private initialized: boolean = false;

  private constructor() {
    this.publishableKey = import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY || '';
    if (!this.publishableKey) {
      console.warn(
        'StripeService: VITE_STRIPE_PUBLISHABLE_KEY not set. Stripe integration disabled.'
      );
    }
  }

  /**
   * Get or create the singleton instance.
   */
  static getInstance(): StripeService {
    if (!this.instance) {
      this.instance = new StripeService();
    }
    return this.instance;
  }

  /**
   * Lazy-load Stripe.js and initialize with publishable key.
   * Safe to call multiple times; only loads once.
   */
  async init(): Promise<void> {
    if (this.initialized) return;
    if (!this.publishableKey) {
      console.warn('StripeService: Cannot init without publishable key');
      return;
    }

    try {
      // Load Stripe.js dynamically
      await this.loadStripeScript();

      // Initialize Stripe with publishable key
      if (window.Stripe) {
        this.stripeInstance = window.Stripe(this.publishableKey);
        this.initialized = true;
        console.log('StripeService: Initialized successfully');
      } else {
        console.error('StripeService: Stripe.js failed to load');
      }
    } catch (err) {
      console.error('StripeService: Initialization error', err);
    }
  }

  /**
   * Dynamically load Stripe.js library from CDN.
   */
  private loadStripeScript(): Promise<void> {
    return new Promise((resolve, reject) => {
      if (window.Stripe) {
        resolve();
        return;
      }

      const script = document.createElement('script');
      script.src = 'https://js.stripe.com/v3/';
      script.async = true;
      script.onload = () => resolve();
      script.onerror = () => reject(new Error('Failed to load Stripe.js'));
      document.head.appendChild(script);
    });
  }

  /**
   * Redirect user to Stripe Checkout for tribe purchase.
   * On successful payment, Stripe webhook should mark tribe as unlocked.
   * For dev/demo, call markPurchased() manually after testing.
   *
   * @param tribeId - The tribe to purchase (e.g., 'metal', 'orchestral')
   * @param priceId - Stripe Price ID (from TRIBE_PRICE_MAP or override)
   */
  async purchaseTribeSkin(tribeId: TribeId, priceId: string): Promise<void> {
    if (!this.initialized) {
      console.warn('StripeService: Not initialized. Calling init() first.');
      await this.init();
    }

    if (!this.stripeInstance) {
      console.error('StripeService: Stripe instance not ready');
      return;
    }

    try {
      // Get current user/session ID (placeholder; integrate with auth system)
      const userId = this.getUserId();

      // Redirect to Stripe Checkout
      // In production, backend creates a Checkout Session and returns sessionId
      const response = await fetch('/api/stripe/create-checkout-session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          priceId,
          tribeId,
          userId,
          // Optional: add success/cancel redirect URLs
          successUrl: window.location.origin + '?purchase=success',
          cancelUrl: window.location.origin + '?purchase=cancel',
        }),
      });

      if (!response.ok) {
        console.error('StripeService: Failed to create checkout session');
        return;
      }

      const { sessionId } = await response.json();

      // Redirect to Stripe Checkout
      const result = await this.stripeInstance.redirectToCheckout({ sessionId });
      if (result.error) {
        console.error('StripeService: Redirect error', result.error.message);
      }
    } catch (err) {
      console.error('StripeService: purchaseTribeSkin error', err);
    }
  }

  /**
   * Check if a tribe is unlocked (purchased or free).
   * @param tribeId - The tribe to check
   */
  isUnlocked(tribeId: TribeId): boolean {
    // Fantasy (Ironveil) is always free
    if (tribeId === 'fantasy') return true;

    // Check localStorage for purchased tribes
    const unlocked = this.getUnlockedTribes();
    return unlocked.includes(tribeId);
  }

  /**
   * Mark a tribe as purchased (store in localStorage).
   * Called by backend webhook or manually after testing.
   * @param tribeId - The tribe to mark as purchased
   */
  markPurchased(tribeId: TribeId): void {
    if (this.isUnlocked(tribeId)) return; // Already unlocked

    const unlocked = this.getUnlockedTribes();
    unlocked.push(tribeId);
    try {
      localStorage.setItem(STORAGE_KEY, unlocked.join(','));
      console.log(`StripeService: Marked '${tribeId}' as purchased`);
    } catch (err) {
      console.error('StripeService: Failed to save to localStorage', err);
    }
  }

  /**
   * Get list of all unlocked tribe IDs.
   * Always includes 'fantasy' (free starter).
   */
  getUnlockedTribes(): TribeId[] {
    const unlocked = ['fantasy'] as TribeId[]; // Always include free starter

    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        const purchased = stored.split(',').filter(Boolean) as TribeId[];
        unlocked.push(...purchased);
      }
    } catch (err) {
      console.warn('StripeService: Failed to read from localStorage', err);
    }

    // Deduplicate
    return Array.from(new Set(unlocked));
  }

  /**
   * Clear all purchases (dev/testing only).
   */
  clearPurchases(): void {
    try {
      localStorage.removeItem(STORAGE_KEY);
      console.log('StripeService: Cleared all purchases');
    } catch (err) {
      console.warn('StripeService: Failed to clear purchases', err);
    }
  }

  /**
   * Get or generate a user ID (placeholder).
   * In production, integrate with auth system.
   */
  private getUserId(): string {
    const key = 'cubitopia_user_id';
    let userId = localStorage.getItem(key);
    if (!userId) {
      userId = 'user_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
      try {
        localStorage.setItem(key, userId);
      } catch (err) {
        console.warn('StripeService: Failed to store user ID', err);
      }
    }
    return userId;
  }

  /**
   * Get the price ID for a tribe (from TRIBE_PRICE_MAP).
   */
  getPriceId(tribeId: TribeId): string {
    return TRIBE_PRICE_MAP[tribeId];
  }

  /**
   * Get all tribe price mappings.
   */
  getTribePriceMap(): Record<TribeId, string> {
    return { ...TRIBE_PRICE_MAP };
  }
}

/**
 * Export singleton instance.
 */
export const stripeService = StripeService.getInstance();
export default StripeService;
