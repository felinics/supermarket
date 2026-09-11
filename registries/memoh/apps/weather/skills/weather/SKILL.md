---
name: weather
description: "Answer current weather and short-range forecast questions for a specific place. Use when the user asks about weather, temperature, feels-like conditions, rain or snow chances, wind, humidity, sunrise or sunset, or hourly/daily travel forecasts, including queries such as weather, forecast, will it rain, temperature in a city, 天气, 气温, 会不会下雨, 降雨概率, and 预报. Do not use for historical weather archives, climate trends, severe-weather safety decisions, official alerts, aviation or marine weather, or detailed meteorological analysis."
---

# Weather

Provide concise, location-specific weather answers from a live source.

## Workflow

1. Resolve the location.
   - Use the city, region, country, or airport code named by the user.
   - If the user omits the location, use reliable location context only when it is clearly available; otherwise ask one short clarifying question.
   - If the location name is ambiguous, clarify unless the surrounding context makes one match clearly dominant.

2. Resolve the time window.
   - Use current conditions for "now" or "right now" questions.
   - Use the shortest forecast window that fits the request for hourly, daily, weekend, or trip-planning questions.
   - Translate relative dates such as "today," "tomorrow," and "this weekend" into exact dates in the answer.

3. Fetch the weather.
   - Use `curl` against `wttr.in` or another live weather source when shell access and `curl` are available.
   - Request only the days needed instead of a long default range.
   - Fall back to the built-in `web_fetch` tool when `curl` is unavailable or shell HTTP access is not practical.
   - If you cannot verify live conditions, say so instead of guessing.

4. Answer directly.
   - Lead with the headline result first.
   - Include precipitation risk for rain, snow, and outdoor-planning questions.
   - Include feels-like temperature, wind, humidity, or visibility only when relevant to the request.
   - Keep the answer brief unless the user asks for more detail.

## Fetch Strategy

Primary shell path:

```bash
curl -s "wttr.in/Shanghai?format=3"
curl -s "wttr.in/Shanghai?format=j1"
```

Fallback web fetch path:

- Use the built-in `web_fetch` tool with:
- `https://wttr.in/Shanghai?format=3`
- `https://wttr.in/Shanghai?format=j1`

Use the same `wttr.in` URLs with `web_fetch` when `curl` is unavailable.

## wttr.in Request Patterns

Current conditions:

```bash
curl -s "wttr.in/Shanghai?format=3"
curl -s "wttr.in/Shanghai?0"
```

Forecasts:

```bash
curl -s "wttr.in/Shanghai"
curl -s "wttr.in/Shanghai?format=v2"
curl -s "wttr.in/Shanghai?1"
```

Format options:

```bash
curl -s "wttr.in/Shanghai?format=%l:+%c+%t+%w"
curl -s "wttr.in/Shanghai?format=j1"
```

Useful format codes:

- `%l` location
- `%c` condition
- `%t` temperature
- `%f` feels like
- `%w` wind
- `%h` humidity
- `%p` precipitation

## Common Request Shapes

- "What's the weather in Paris today?" -> Give a current summary and, if available, today's high and low.
- "Will it rain in Seattle tomorrow?" -> Focus on precipitation and include the exact date.
- "Weather for my trip to Tokyo this weekend" -> Summarize each day in the requested travel window.
- "Do I need a jacket tonight in Boston?" -> Translate the intent into practical temperature and wind guidance.

## Guardrails

- Treat general weather data as convenience information, not emergency guidance.
- Redirect severe-weather or safety-critical questions to an official alerting authority.
- Do not use this skill for historical climatology, long-range climate trends, or specialized aviation or marine forecasting.
- Do not assume `curl` is installed; when it is missing, fall back to `web_fetch`.

## Output Rules

- Use the user's preferred units when they are explicit.
- Otherwise follow locale or source defaults and avoid unnecessary conversions.
- Include at least one exact date when the user asks with relative time words.
- Mention source limitations briefly when the available data is incomplete or uncertain.
