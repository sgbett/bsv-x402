import type { SitePolicy, SitePolicyAction, SpendLimits, TwoFactorProvider } from "./types"

export type SitePromptFn = (origin: string) => Promise<SitePolicyAction>

/**
 * Default prompt using window.confirm/prompt for site policy decisions.
 * Consumers can replace this with custom UI.
 */
export const defaultSitePrompt: SitePromptFn = async (origin: string) => {
  if (typeof globalThis.confirm !== "function") return "global"

  const allow = globalThis.confirm(
    `First payment to ${origin}.\n\nUse your global spending limits for this site?\n\nOK = Use global limits\nCancel = Block this site`,
  )
  return allow ? "global" : "block"
}

/**
 * Resolves the site policy for a given origin.
 * If the origin already has a policy, returns it.
 * If not, and requirePerSitePrompt is true, prompts the user.
 * Otherwise falls back to global limits.
 */
export async function resolveSitePolicy(
  origin: string,
  limits: SpendLimits,
  twoFactorProvider?: TwoFactorProvider,
  promptFn: SitePromptFn = defaultSitePrompt,
): Promise<SitePolicy> {
  // Already have a policy for this origin
  const existing = limits.sitePolicies[origin]
  if (existing) return existing

  // No per-site prompting — use global limits
  if (!limits.requirePerSitePrompt) {
    return { origin, action: "global" }
  }

  // 2FA gate for new site approval
  if (limits.require2fa.onNewSiteApproval) {
    if (!twoFactorProvider) {
      return { origin, action: "block" }
    }
    const verified = await twoFactorProvider.verify({
      type: "new-site-approval",
      origin,
    })
    if (!verified) {
      return { origin, action: "block" }
    }
  }

  const action = await promptFn(origin)
  return { origin, action }
}
