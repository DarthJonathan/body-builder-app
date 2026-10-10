<script lang="ts">
  import '../styles.css';
  import { onMount } from 'svelte';
  import { pwaInfo } from 'virtual:pwa-info';

  let { children } = $props();
  onMount(async () => {
    if (!import.meta.env.PROD) return;
    const { registerSW } = await import('virtual:pwa-register');
    // Updates stay waiting until the app can safely activate them.
    registerSW({ immediate: true });
  });
</script>

<svelte:head>
  <title>BodyBuilder</title>
  <meta name="description" content="Your personal training companion." />
  {#if pwaInfo}{@html pwaInfo.webManifest.linkTag}{/if}
</svelte:head>

{@render children()}
