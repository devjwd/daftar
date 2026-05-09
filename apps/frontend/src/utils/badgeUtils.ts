import { criteriaToRuleType } from '../config/badges';

export const mapBadgeDefinitionToRow = (badge: any) => {
  if (!badge) return null;
  
  const firstCriterion = badge.criteria?.[0] || { type: 'anyone', params: {} };
  const ruleType = criteriaToRuleType(firstCriterion.type);
  
  return {
    badge_id: badge.id || badge.badge_id,
    on_chain_badge_id: badge.onChainBadgeId ?? badge.on_chain_badge_id,
    name: badge.name,
    description: badge.description,
    image_url: badge.imageUrl || badge.image_url,
    category: badge.category,
    rarity: badge.rarity,
    xp_value: badge.xp || badge.xp_value,
    criteria: badge.criteria,
    metadata: badge.metadata,
    is_public: badge.isPublic ?? badge.is_public ?? true,
    enabled: badge.enabled !== false,
    is_active: badge.enabled !== false,
    rule_type: ruleType,
    rule_params: firstCriterion.params || {},
  };
};
