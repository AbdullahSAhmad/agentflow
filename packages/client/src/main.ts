import { createApp } from './app.js';
import { WsClient } from './connection/ws-client.js';
import { StateStore } from './connection/state-store.js';
import { WorldManager } from './world/world-manager.js';
import { AgentManager } from './agents/agent-manager.js';
import { Overlay } from './ui/overlay.js';
import { AgentDetailPanel } from './ui/agent-detail-panel.js';
import { Timeline } from './ui/timeline.js';
import { SoundManager } from './audio/sound-manager.js';
import { NotificationManager } from './audio/notification-manager.js';
import { ZoneHeatmap } from './ui/zone-heatmap.js';
import { CommandPalette } from './ui/command-palette.js';
import { AnalyticsPanel } from './ui/analytics-panel.js';
import { LayoutEditor, applySavedLayout } from './ui/layout-editor.js';
import { ZONE_MAP } from '@agentflow/shared';

async function main() {
  const appEl = document.getElementById('app')!;

  // Init Pixi application
  const pixiApp = await createApp(appEl);

  // Init state store
  const store = new StateStore();

  // ── Feature 5: Layout Editor ──
  // Apply saved layout BEFORE WorldManager so ZoneRenderer picks up persisted positions
  applySavedLayout();

  // Init world (zones, grid, camera)
  const world = new WorldManager(pixiApp);

  // Init layout editor (after WorldManager so it can trigger redraws)
  const layoutEditor = new LayoutEditor(world);

  // Init agent manager (bridges state -> rendering)
  const agentManager = new AgentManager(pixiApp, world, store);

  // Init audio
  const sound = new SoundManager();
  const notifications = new NotificationManager();
  agentManager.setSoundManager(sound);
  agentManager.setNotificationManager(notifications);

  // Init overlay (HTML sidebar)
  const overlay = new Overlay(store);

  // Init detail panel
  const detailPanel = new AgentDetailPanel(store);
  overlay.setAgentClickHandler((agentId) => detailPanel.open(agentId));

  // Init timeline
  const timeline = new Timeline(store);
  timeline.setReplayCallback((agents) => {
    agentManager.rebuildFromState(agents);
  });

  // ── Feature 1: Zone Activity Heatmap ──
  const heatmap = new ZoneHeatmap(store);
  let heatmapVisible = true;

  // ── Feature 3: Analytics Panel ──
  const analytics = new AnalyticsPanel(store);

  // ── Feature 2: Command Palette ──
  const commandPalette = new CommandPalette(store, (action, payload) => {
    switch (action) {
      case 'focus-zone': {
        const zone = ZONE_MAP.get(payload);
        if (zone) {
          world.camera.panTo(
            zone.x + zone.width / 2,
            zone.y + zone.height / 2
          );
        }
        break;
      }
      case 'focus-agent': {
        detailPanel.open(payload);
        break;
      }
      case 'reset-camera':
        world.resetCamera();
        break;
      case 'zoom-in':
        world.camera.zoomIn();
        break;
      case 'zoom-out':
        world.camera.zoomOut();
        break;
      case 'toggle-mute':
        sound.init();
        sound.muted = !sound.muted;
        muteBtn.textContent = sound.muted ? '\u{1F507}' : '\u{1F508}';
        muteBtn.classList.toggle('muted', sound.muted);
        break;
      case 'toggle-heatmap':
        heatmapVisible = !heatmapVisible;
        const heatmapEl = document.getElementById('zone-heatmap');
        if (heatmapEl) heatmapEl.style.display = heatmapVisible ? 'block' : 'none';
        break;
      case 'toggle-analytics':
        analytics.toggle();
        break;
      case 'timeline-live':
        // Timeline handles its own live mode
        break;
    }
  });

  // Connect WebSocket
  const ws = new WsClient(store);
  ws.connect();

  // Zoom controls
  document.getElementById('zoom-in')!.addEventListener('click', () => world.camera.zoomIn());
  document.getElementById('zoom-out')!.addEventListener('click', () => world.camera.zoomOut());
  document.getElementById('zoom-reset')!.addEventListener('click', () => world.resetCamera());

  // Audio controls
  const muteBtn = document.getElementById('mute-btn')!;
  const volumeSlider = document.getElementById('volume-slider') as HTMLInputElement;
  const volumeLabel = document.getElementById('volume-label')!;

  muteBtn.addEventListener('click', () => {
    sound.init(); // Unlock AudioContext on first user gesture
    sound.muted = !sound.muted;
    muteBtn.textContent = sound.muted ? '\u{1F507}' : '\u{1F508}';
    muteBtn.classList.toggle('muted', sound.muted);
  });

  volumeSlider.addEventListener('input', () => {
    sound.init(); // Unlock AudioContext on first user gesture
    const val = parseInt(volumeSlider.value, 10);
    sound.volume = val / 100;
    volumeLabel.textContent = `${val}%`;
  });

  // Analytics button in sidebar
  const analyticsBtn = document.getElementById('analytics-btn');
  analyticsBtn?.addEventListener('click', () => {
    analytics.toggle();
  });

  // Command palette hint button
  const cmdHintBtn = document.getElementById('cmd-hint');
  cmdHintBtn?.addEventListener('click', () => {
    commandPalette.toggle();
  });

  // Request notification permission on first interaction
  document.addEventListener('click', () => {
    sound.init();
    notifications.requestPermission();
  }, { once: true });

  // Game loop
  pixiApp.ticker.add(() => {
    agentManager.update(pixiApp.ticker.deltaMS);

    // Update heatmap overlay position to match camera
    const root = world.root;
    if (heatmapVisible) {
      heatmap.updateTransform(root.x, root.y, root.scale.x);
    }

    // Update layout editor overlay position to match camera
    layoutEditor.updateTransform(root.x, root.y, root.scale.x);
  });

  console.log('Claude Code Visualizer started');
}

main().catch(console.error);
