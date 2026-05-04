export const mapBadgeDefinitionToRow = (badge: any) => {
  if (!badge) return null;
  return {
    badge_id: badge.id,
    on_chain_badge_id: badge.onChainBadgeId,
    name: badge.name,
    description: badge.description,
    image_url: badge.imageUrl,
    category: badge.category,
    rarity: badge.rarity,
    xp_value: badge.xp,
    criteria: badge.criteria,
    metadata: badge.metadata,
    is_public: badge.isPublic,
    enabled: badge.enabled !== false,
  };
};
