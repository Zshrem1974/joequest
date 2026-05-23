#!/usr/bin/env node
/*
 * JoeQuest — re-curate city-wide picks from already-collected per-café data.
 * Skips Google Places + per-café Claude calls. Just runs the final curation
 * step on a hardcoded set of picks (Boca-only after filtering 3 outside-city
 * hits).
 *
 * USAGE:
 *   ANTHROPIC_API_KEY=yyy node recurate.js
 */

import Anthropic from "@anthropic-ai/sdk";

const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;
const MODEL = "claude-opus-4-7";
const CITY = "Boca Raton, FL";

// 31 cafés — excludes Cali Coffee (Coconut Creek), Colombian Coffee House @ Delray, Le Petit Parisian (Deerfield)
const RESULTS = [
  { displayName: "Belladukes",                                   drink: { name: "Iced latte",                       confidence: "medium", mention_count: 2, quote: "grabbed an iced latte... the coffee here is amazing, dare I say the best in Boca" }, food: { name: "Blueberry muffin",                  confidence: "medium", mention_count: 1, quote: "an excellent blueberry muffin. It was delicious." } },
  { displayName: "Cafe Louis Coffee & Espresso Bar",             drink: { name: "Espresso drinks",                  confidence: "high",   mention_count: 4, quote: "The espresso drinks are top tier" },                                                              food: { name: "Fresh pastries and quiche",         confidence: "medium", mention_count: 1, quote: "the food is just as good, especially the fresh pastries and quiche" } },
  { displayName: "CAFÉ CHÉRI",                                   drink: { name: "Strawberry Bliss Matcha",          confidence: "medium", mention_count: 1, quote: "I got the strawberry bliss matcha... tasted fresh and delicious" },                                food: { name: "Crepes",                            confidence: "high",   mention_count: 2, quote: "The crepes are amazing — perfectly cooked, beautifully presented" } },
  { displayName: "Carmela Coffee - Uptown Boca",                 drink: { name: "Matcha latte",                     confidence: "medium", mention_count: 1, quote: "Shoutout to the matcha latte" },                                                                  food: { name: "Avocado toast",                     confidence: "high",   mention_count: 2, quote: "Some of the best, freshest avocado toast out there" } },
  { displayName: "Carmela Coffee - BRiC",                        drink: { name: "Cortado",                          confidence: "medium", mention_count: 1, quote: "Her Cortado is a true masterpiece, crafted with skill and care" },                                food: { name: "Nutella Strawberry Croissant",      confidence: "medium", mention_count: 1, quote: "Nutella strawberry croissant drizzled with chocolate syrup and powdered sugar! Its delicious!!" } },
  { displayName: "Carmela Coffee - East Boca",                   drink: { name: "Iced latte",                       confidence: "high",   mention_count: 3, quote: "the iced lattes are always so good" },                                                            food: { name: "Shakshuka",                         confidence: "high",   mention_count: 2, quote: "It was delicious, plenty of feta, heated and ready" } },
  { displayName: "Carmela Coffee - Park Place",                  drink: { name: "Latte",                            confidence: "medium", mention_count: 3, quote: "seashells in one coffee and sea turtles on another coffee. Very pretty and tasty!" },             food: { name: "Goat cheese and caramelized onion pizza", confidence: "low", mention_count: 1, quote: "the goat cheese and caramelized onion pizza to go… Trust me they were delicious" } },
  { displayName: "Colombian Coffee House (495 NE 20th St)",      drink: { name: "Latte",                            confidence: "medium", mention_count: 2, quote: "Ordered an iced vanilla latte, it was delicious" },                                                food: { name: "Arepas",                            confidence: "low",    mention_count: 1, quote: "first time trying Arepas and it was absolutely delicious" } },
  { displayName: "Côte France",                                  drink: { name: null,                               confidence: "none",   mention_count: 0, quote: null },                                                                                              food: { name: "Avocado toast",                     confidence: "medium", mention_count: 1, quote: "Every individual detail from the toast itself to the fresh avocado spread...was incredible" } },
  { displayName: "Crema Gourmet Mizner",                         drink: { name: "Iced Latte",                       confidence: "medium", mention_count: 1, quote: "We had two iced lattes... Everything was fresh and well-presented" },                              food: { name: "Cheesecake",                        confidence: "medium", mention_count: 1, quote: "the cheesecake was definitely a standout" } },
  { displayName: "Dolce Café",                                   drink: { name: "Illy coffee",                      confidence: "high",   mention_count: 3, quote: "they serve illy coffee which illy is the best Italian coffee ever made" },                         food: { name: "Panini",                            confidence: "high",   mention_count: 4, quote: "their paninis are the best" } },
  { displayName: "Espresso Joint",                               drink: { name: "Whipped Honey Latte",              confidence: "high",   mention_count: 2, quote: "Whipped honey latte was amazing" },                                                                food: { name: "Breakfast Croissant",               confidence: "medium", mention_count: 1, quote: "The breakfast croissant is addicting" } },
  { displayName: "Foxtail Coffee - West Boca",                   drink: { name: "Cappuccino",                       confidence: "medium", mention_count: 1, quote: "my favorite still has to be the traditional hot cappuccino" },                                    food: { name: null,                                confidence: "none",   mention_count: 0, quote: null } },
  { displayName: "Foxtail Coffee Boca Valley",                   drink: { name: "Cappuccino",                       confidence: "low",    mention_count: 1, quote: "the coffee was incredibly bitter" },                                                                food: { name: "Sweets or ice cream",               confidence: "low",    mention_count: 1, quote: "They have sweets and ice creams besides the yummy coffee" } },
  { displayName: "Kixi Cafe",                                    drink: { name: "Matcha",                           confidence: "medium", mention_count: 2, quote: "Drinks are delicious — especially the matcha" },                                                   food: { name: "Croffle",                           confidence: "medium", mention_count: 1, quote: "Croffle- yes that is a croissant and waffle together and it is actually quite delicious" } },
  { displayName: "La Boulangerie Boul'Mich",                     drink: { name: "Coffee",                           confidence: "low",    mention_count: 1, quote: "great coffee, and a ton of food options" },                                                          food: { name: "Grilled cheese with tomato soup",   confidence: "high",   mention_count: 2, quote: "grilled cheese with tomato soup was pure comfort and perfectly done" } },
  { displayName: "La Mesa, Café - Bistro",                       drink: { name: "Cortado",                          confidence: "medium", mention_count: 1, quote: "the most excellent one I've had. I thought about it all day" },                                    food: { name: "Empanadas",                         confidence: "high",   mention_count: 2, quote: "The empanadas are to die for!" } },
  { displayName: "Living Green Cafe - Boca",                     drink: { name: "Fresh juice",                      confidence: "high",   mention_count: 3, quote: "Their fresh juices are amazing, you can really taste the quality and freshness" },                  food: { name: "Salads and bowls",                  confidence: "medium", mention_count: 2, quote: "The salads, bowls, and juices never miss" } },
  { displayName: "Long Story Short Cafe",                        drink: { name: "Latte with cold foam",             confidence: "medium", mention_count: 2, quote: "they make my favorite lattes with cold foam on top" },                                              food: { name: "Turkey sandwich",                   confidence: "low",    mention_count: 1, quote: "the turkey sandwich was delicious" } },
  { displayName: "Maison Brunch – Boca Raton",                   drink: { name: null,                               confidence: "none",   mention_count: 0, quote: null },                                                                                              food: { name: "Croissant",                         confidence: "medium", mention_count: 1, quote: "enjoying a croissant that is simply incredible" } },
  { displayName: "Mane Coffee",                                  drink: { name: "Pandana Banana Matcha",            confidence: "medium", mention_count: 1, quote: "might be one of the best matcha drinks I've ever had" },                                            food: { name: "Pain au chocolat",                  confidence: "low",    mention_count: 1, quote: "The pastries were good, especially the pain au chocolat" } },
  { displayName: "Rosalia's Botanical Cafe",                     drink: { name: "Peach Please smoothie",            confidence: "medium", mention_count: 1, quote: "Absolutely loved my little bouquet of flowers on my Peach Please smoothie" },                      food: { name: "Triple berry crumble cake",         confidence: "high",   mention_count: 1, quote: "triple berry crumble cake!! Holy crap, that thing was PERFECTION" } },
  { displayName: "Saquella Cafe",                                drink: { name: "Latte",                            confidence: "low",    mention_count: 1, quote: "Latte was also delicious" },                                                                          food: { name: "Saquella cookies",                  confidence: "medium", mention_count: 1, quote: "Oh, how I've missed my Saquella cookies... as delicious as ever" } },
  { displayName: "Subculture Coffee Mizner",                     drink: { name: "Dirty chai latte",                 confidence: "medium", mention_count: 1, quote: "they never miss! Very well balance of a good dirty chai latte" },                                  food: { name: "Peruvian beef empanadas",           confidence: "high",   mention_count: 2, quote: "Their empanadas are the best, we get the Peruvian beef empanadas" } },
  { displayName: "the seed. Coffee + Juice Bar (Yamato)",        drink: { name: "Cookie Butter Latte",              confidence: "medium", mention_count: 1, quote: "cookie butter latte was not too sweet and was a perfect balanced latte" },                          food: { name: "Paradise Slider",                   confidence: "high",   mention_count: 1, quote: "the slider was the star of the show" } },
  { displayName: "the seed. Coffee + Juice Bar (Palmetto)",      drink: { name: "Strawberry Matcha",                confidence: "medium", mention_count: 1, quote: "ordered a strawberry matcha within minutes of landing. It was just as amazing" },                  food: { name: "Bagel Bombs",                       confidence: "high",   mention_count: 3, quote: "the bagels were the bomb! They had the perfect amount of cream cheese" } },
  { displayName: "The Pots Cafe",                                drink: { name: "Cappuccino",                       confidence: "medium", mention_count: 2, quote: "I got a cappuccino and the fig & goat cheese croissant sandwich" },                                food: { name: "Fig & goat cheese croissant sandwich", confidence: "high", mention_count: 1, quote: "the fig & goat cheese croissant sandwich, which was delicious" } },
  { displayName: "Third Place Coffee Lounge",                    drink: { name: "Spiced Apple Cider",               confidence: "medium", mention_count: 2, quote: "hot spiced apple cider were both delicious" },                                                       food: { name: "Pastries",                          confidence: "medium", mention_count: 3, quote: "the pastries were delicious" } },
  { displayName: "Tiki Coffee and Desserts",                     drink: { name: "Mojito",                           confidence: "medium", mention_count: 2, quote: "Loved the mojito and crepes" },                                                                      food: { name: "Kunafa",                            confidence: "high",   mention_count: 3, quote: "Their kunafa is insanely good: golden, crispy, perfectly sweet" } },
  { displayName: "Tin Muffin Cafe",                              drink: { name: "Coffee",                           confidence: "low",    mention_count: 1, quote: "I only had a coffee and felt like family" },                                                          food: { name: "Herb roasted chicken salad",        confidence: "high",   mention_count: 2, quote: "I recommend the herb roasted chicken salad or the quiche both are delicious" } },
  { displayName: "VI Coffee Bar",                                drink: { name: "Iced Dolce Vita",                  confidence: "medium", mention_count: 1, quote: "chicken caesar wrap and an iced dolce vita is our go-to order" },                                  food: { name: "Caesar Wrap",                       confidence: "high",   mention_count: 3, quote: "The BEST Caesar wrap in town — literally I'm obsessed!!" } },
];

const CURATE_SYSTEM = `You are JoeQuest's city-wide curator. You receive a list of cafés in one city, each with its best drink pick and best food pick (with confidence levels and short quotes from reviewers).

Your job: pick the SINGLE best drink in the entire city and the SINGLE best food in the entire city — the items most worth a special trip.

How to weigh:
1. Confidence first. A "high" confidence pick from one café outranks a "medium" from another, even if the medium sounds tastier.
2. Specificity of praise. "Best flat white in Boca" outranks "good coffee".
3. Mention count. More reviewers naming the item → stronger signal.
4. Tie-break on distinctiveness — favor items that are signature to one shop over generic items available everywhere.

For each city-wide pick, name the café it's at, the item, why it won, and the strongest supporting quote (a real phrase from the per-café data — do not invent).`;

const cityPickSchema = {
  type: "object",
  properties: {
    cafe:   { type: "string" },
    item:   { type: "string" },
    reason: { type: "string" },
    quote:  { type: "string" },
  },
  required: ["cafe", "item", "reason", "quote"],
  additionalProperties: false,
};
const CITY_SCHEMA = {
  type: "object",
  properties: { drink: cityPickSchema, food: cityPickSchema },
  required: ["drink", "food"],
  additionalProperties: false,
};

async function curate(client) {
  const block = RESULTS.map((r, i) => {
    const d = r.drink, f = r.food;
    const dline = d?.name ? `  drink: ${d.name} (${d.confidence}, ${d.mention_count}× mentions) — "${d.quote ?? ""}"` : `  drink: (none)`;
    const fline = f?.name ? `  food: ${f.name} (${f.confidence}, ${f.mention_count}× mentions) — "${f.quote ?? ""}"` : `  food: (none)`;
    return `${i + 1}. ${r.displayName}\n${dline}\n${fline}`;
  }).join("\n\n");

  const userMessage = `City: ${CITY}\n\nPer-café picks (${RESULTS.length} cafés):\n\n${block}`;

  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 1024,
    system: [{ type: "text", text: CURATE_SYSTEM, cache_control: { type: "ephemeral" } }],
    messages: [{ role: "user", content: userMessage }],
    output_config: { format: { type: "json_schema", schema: CITY_SCHEMA } },
  });

  const text = response.content.find((b) => b.type === "text")?.text;
  return { city: JSON.parse(text), usage: response.usage };
}

async function main() {
  if (!ANTHROPIC_KEY) {
    console.error("\n❌  Missing ANTHROPIC_API_KEY.\n");
    process.exit(1);
  }
  const client = new Anthropic({ apiKey: ANTHROPIC_KEY });

  console.log(`\n🤖  Re-curating from ${RESULTS.length} Boca-only cafés…`);
  const { city, usage } = await curate(client);
  console.log(`    tokens: ${usage.input_tokens} in / ${usage.output_tokens} out`);

  const line = "═".repeat(64);
  console.log(`\n${line}`);
  console.log(`🏆  BOCA RATON — CITY-WIDE PICKS  (Boca-only, ${RESULTS.length} cafés)`);
  console.log(line);
  console.log(`\n☕  BEST DRINK IN BOCA`);
  console.log(`    ${city.drink.item}  @  ${city.drink.cafe}`);
  console.log(`    ${city.drink.reason}`);
  console.log(`    "${city.drink.quote}"`);
  console.log(`\n🥐  BEST FOOD IN BOCA`);
  console.log(`    ${city.food.item}  @  ${city.food.cafe}`);
  console.log(`    ${city.food.reason}`);
  console.log(`    "${city.food.quote}"`);
  console.log(`\n${line}\n`);
}

main().catch((err) => {
  console.error(`\n❌  Error: ${err.message}\n`);
  process.exit(1);
});
