<script setup lang="ts">
</script>

<template>
  <div class="container">
    <div class="card">
      <div class="icon">🏗️</div>
      <h1>Supermarket</h1>
      <p class="subtitle">Skill Registry</p>
      <div class="badge">WORK IN PROGRESS</div>
      <p class="desc">
        Discover and install Skill Packages for Memoh.
      </p>
      <div class="links">
        <a href="/api/packages" target="_blank">API: Packages</a>
        <a href="/api/skills" target="_blank">API: Skills</a>
      </div>
    </div>
  </div>
</template>

<style>
*,
*::before,
*::after {
  margin: 0;
  padding: 0;
  box-sizing: border-box;
}

body {
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
  background: #0f0f11;
  color: #e4e4e7;
  min-height: 100vh;
}

.container {
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 100vh;
  padding: 2rem;
}

.card {
  text-align: center;
  max-width: 480px;
  width: 100%;
}

.icon {
  font-size: 3.5rem;
  margin-bottom: 1rem;
}

h1 {
  font-size: 2.25rem;
  font-weight: 700;
  letter-spacing: -0.02em;
  color: #fafafa;
}

.subtitle {
  font-size: 1rem;
  color: #71717a;
  margin-top: 0.25rem;
}

.badge {
  display: inline-block;
  margin-top: 1.5rem;
  padding: 0.35rem 1rem;
  font-size: 0.75rem;
  font-weight: 600;
  letter-spacing: 0.1em;
  color: #fbbf24;
  border: 1px solid #fbbf2440;
  border-radius: 9999px;
  background: #fbbf2410;
}

.desc {
  margin-top: 1.25rem;
  font-size: 0.95rem;
  line-height: 1.6;
  color: #a1a1aa;
}

.links {
  margin-top: 2rem;
  display: flex;
  gap: 1rem;
  justify-content: center;
}

.links a {
  padding: 0.5rem 1.25rem;
  font-size: 0.85rem;
  font-weight: 500;
  color: #e4e4e7;
  background: #27272a;
  border: 1px solid #3f3f46;
  border-radius: 8px;
  text-decoration: none;
  transition: background 0.15s, border-color 0.15s;
}

.links a:hover {
  background: #3f3f46;
  border-color: #52525b;
}
</style>
