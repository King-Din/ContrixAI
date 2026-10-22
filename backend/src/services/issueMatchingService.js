"use strict";

const SCORING_WEIGHTS = Object.freeze({
  SEMANTIC_SIMILARITY: 0.40,
  SKILL_INTEREST_OVERLAP: 0.25,
  PREREQUISITE_FIT: 0.20,
  TIME_FIT: 0.10,
  AGE: 0.05
});

/**
 * Normalizes text terms for matching.
 */
function tokenize(text) {
  if (!text) return [];
  return String(text)
    .toLowerCase()
    .replace(/[^a-z0-9\s_-]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 1);
}

/**
 * Calculates Jaccard similarity between two sets of tokens.
 */
function jaccardSimilarity(setA, setB) {
  if (!setA.size && !setB.size) return 0;
  let intersection = 0;
  for (const item of setA) {
    if (setB.has(item)) intersection++;
  }
  const union = setA.size + setB.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

/**
 * Scores a single issue against a contributor profile.
 * Profile: { skills: string[], interests: string[], availability: { hoursPerWeek: number } }
 * Issue: { title, body, labels, requirements, prerequisites, status, createdAt, updatedAt }
 */
function scoreIssueFit(issue, profile = {}) {
  const userSkills = (profile.skills || []).map((s) => s.toLowerCase().trim());
  const userInterests = (profile.interests || []).map((i) => i.toLowerCase().trim());
  const userHours = Number(profile.availability?.hoursPerWeek) || 10;

  const issueLabels = (issue.labels || []).map((l) => l.toLowerCase().trim());
  const issueReqs = (issue.requirements || []).map((r) => r.toLowerCase().trim());
  const issuePrereqs = issue.prerequisites || [];

  // 1. Skill & Interest Overlap (25%)
  const userSkillsSet = new Set([...userSkills, ...userInterests]);
  const issueKeywordsSet = new Set([...issueLabels, ...issueReqs]);

  let matchedSkills = [];
  for (const s of userSkillsSet) {
    for (const kw of issueKeywordsSet) {
      if (kw.includes(s) || s.includes(kw)) {
        matchedSkills.push(s);
      }
    }
  }
  matchedSkills = [...new Set(matchedSkills)];
  const skillScore = issueKeywordsSet.size > 0
    ? Math.min(1.0, matchedSkills.length / Math.max(1, issueKeywordsSet.size))
    : 0.5;

  // 2. Prerequisite Fit (20%)
  const missingPrerequisites = [];
  let satisfiedPrereqs = 0;

  for (const prereq of issuePrereqs) {
    const label = (prereq.label || "").toLowerCase();
    const desc = (prereq.description || "").toLowerCase();
    const isMet = userSkills.some((s) => label.includes(s) || desc.includes(s));
    if (isMet) {
      satisfiedPrereqs++;
    } else {
      missingPrerequisites.push({
        label: prereq.label,
        description: prereq.description,
        docRef: prereq.docRef || null
      });
    }
  }

  const prereqScore = issuePrereqs.length > 0
    ? satisfiedPrereqs / issuePrereqs.length
    : 1.0;

  // 3. Time Fit (10%)
  // Default expected hours for an issue can be estimated from requirements count or labels (e.g. beginner = 5h, intermediate = 10h)
  const isBeginner = issueLabels.some((l) => l.includes("good first") || l.includes("beginner") || l.includes("starter"));
  const estimatedHours = isBeginner ? 5 : 10;
  const timeScore = userHours >= estimatedHours ? 1.0 : Math.max(0.2, userHours / estimatedHours);

  // 4. Semantic Similarity (40%)
  const profileTokens = new Set([...tokenize(userSkills.join(" ")), ...tokenize(userInterests.join(" "))]);
  const issueTokens = new Set([...tokenize(issue.title), ...tokenize(issue.body || "")]);
  const semanticScore = jaccardSimilarity(profileTokens, issueTokens);

  // 5. Age / Freshness (5%)
  const now = Date.now();
  const issueDate = new Date(issue.updatedAt || issue.createdAt || now).getTime();
  const daysOld = (now - issueDate) / (1000 * 60 * 60 * 24);
  const ageScore = Math.max(0.1, 1.0 - Math.min(1.0, daysOld / 60)); // newer = higher, decays over 60 days

  // Weighted total score
  const overallScore = Number(
    (
      SCORING_WEIGHTS.SEMANTIC_SIMILARITY * semanticScore +
      SCORING_WEIGHTS.SKILL_INTEREST_OVERLAP * skillScore +
      SCORING_WEIGHTS.PREREQUISITE_FIT * prereqScore +
      SCORING_WEIGHTS.TIME_FIT * timeScore +
      SCORING_WEIGHTS.AGE * ageScore
    ).toFixed(3)
  );

  const fitReasons = [];
  if (matchedSkills.length > 0) {
    fitReasons.push(`Matches your skills/interests in ${matchedSkills.join(", ")}`);
  }
  if (satisfiedPrereqs > 0) {
    fitReasons.push(`Satisfies ${satisfiedPrereqs} prerequisite(s)`);
  }
  if (userHours >= estimatedHours) {
    fitReasons.push(`Fits your ${userHours}h/week availability`);
  }
  if (isBeginner) {
    fitReasons.push("Curated as a good starter issue for new contributors");
  }

  return {
    score: overallScore,
    breakdown: {
      semanticSimilarity: semanticScore,
      skillInterestOverlap: skillScore,
      prerequisiteFit: prereqScore,
      timeFit: timeScore,
      age: ageScore
    },
    fitReasons,
    missingPrerequisites,
    weights: SCORING_WEIGHTS
  };
}

/**
 * Filter and rank issues for a contributor profile.
 */
function rankIssuesForContributor(issues, profile, options = {}) {
  const { requireOpen = true } = options;

  let candidates = issues;
  if (requireOpen) {
    // Note: for the demo walkthrough, we can score all issues, but separate open vs assigned
  }

  const scored = candidates.map((issue) => {
    const fit = scoreIssueFit(issue, profile);
    return {
      issue,
      score: fit.score,
      fitReasons: fit.fitReasons,
      missingPrerequisites: fit.missingPrerequisites,
      breakdown: fit.breakdown,
      status: issue.status,
      isAvailable: issue.status === "open"
    };
  });

  // Sort descending by score
  scored.sort((a, b) => b.score - a.score);

  return scored;
}

module.exports = {
  SCORING_WEIGHTS,
  scoreIssueFit,
  rankIssuesForContributor
};
