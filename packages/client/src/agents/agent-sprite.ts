import { Container, Graphics, Sprite, Text, TextStyle, Texture } from 'pixi.js';
import type { AgentState, AgentPalette } from '@agentflow/shared';
import { COLORS } from '@agentflow/shared';
import { MAIN_SPRITES, SUB_SPRITES, type SpriteSet } from '../sprites/sprite-data.js';
import { createSpriteTexture, spriteKey } from '../sprites/sprite-factory.js';

type AnimState = 'idle' | 'walk' | 'working';

export interface SpeechMessage {
  text: string;
  type: 'tool' | 'text' | 'input-needed';
  icon?: string;
}

const IDLE_FPS = 2;
const WALK_FPS = 4;
const MOVE_SPEED = 100; // pixels per second
const ARRIVAL_THRESHOLD = 3;
const BOB_AMPLITUDE = 1.5;
const BOB_SPEED = 2;
const SPEECH_DURATION = 3500;
const SPEECH_ROTATE_DURATION = 3000; // time per message in queue
const SPEECH_FADE_DURATION = 500;
const FADE_OUT_DURATION = 600;
const BUBBLE_PAD_X = 8;
const BUBBLE_PAD_Y = 5;
const BUBBLE_RADIUS = 6;
const BUBBLE_MAX_WIDTH = 160;
const POINTER_SIZE = 5;

// Bubble colors by type
const BUBBLE_COLORS = {
  tool:         { bg: 0x1a2340, border: 0x3a5080, text: 0xe8f0ff },
  text:         { bg: 0x1a2340, border: 0x404860, text: 0xcccccc },
  'input-needed': { bg: 0x3a2010, border: 0xff9800, text: 0xffcc80 },
} as const;

/**
 * Animated agent sprite with name label and speech bubble.
 * Handles its own movement, animation, and speech.
 */
export class AgentSprite {
  public readonly container = new Container();

  private sprite: Sprite;
  private nameLabel: Text;

  // Speech bubble components
  private speechBubble: Container;
  private speechBg: Graphics;
  private speechText: Text;
  private speechPointer: Graphics;
  private speechTimer = 0;
  private speechQueue: SpeechMessage[] = [];
  private currentSpeechIndex = 0;
  private rotateTimer = 0;
  private currentSpeechType: SpeechMessage['type'] = 'tool';

  // Input-needed pulse
  private needsInputPulse = 0;

  // Child count badge
  private childBadge: Container | null = null;
  private childBadgeBg: Graphics | null = null;
  private childBadgeText: Text | null = null;

  private animState: AnimState = 'idle';
  private isIdleState = false;

  private spriteHeight: number;
  private textures: {
    idle: [Texture, Texture];
    walk: [Texture, Texture];
    working: Texture;
  };

  private frameTimer = 0;
  private frameIndex = 0;

  // Movement
  private targetX: number;
  private targetY: number;
  private isMoving = false;
  private bobTimer: number;
  private baseY: number;

  // Fade out
  private fadingOut = false;
  private fadeTimer = 0;
  private fadeResolve: (() => void) | null = null;

  // Spawn animation
  public spawnAnimTimer = 0;
  private static SPAWN_ANIM_DURATION = 400;

  constructor(
    agent: AgentState,
    palette: AgentPalette,
    renderer: any,
  ) {
    const isSubagent = agent.role === 'subagent';
    const spriteSet: SpriteSet = isSubagent ? SUB_SPRITES : MAIN_SPRITES;
    const keyPrefix = isSubagent ? 'sub' : 'main';
    const ci = agent.colorIndex;

    this.spriteHeight = spriteSet.size * 3;

    // Generate all textures
    this.textures = {
      idle: [
        createSpriteTexture(renderer, spriteSet.idle[0], palette, spriteKey(`${keyPrefix}_idle0`, ci)),
        createSpriteTexture(renderer, spriteSet.idle[1], palette, spriteKey(`${keyPrefix}_idle1`, ci)),
      ],
      walk: [
        createSpriteTexture(renderer, spriteSet.walk[0], palette, spriteKey(`${keyPrefix}_walk0`, ci)),
        createSpriteTexture(renderer, spriteSet.walk[1], palette, spriteKey(`${keyPrefix}_walk1`, ci)),
      ],
      working: createSpriteTexture(renderer, spriteSet.working, palette, spriteKey(`${keyPrefix}_working`, ci)),
    };

    // Create sprite
    this.sprite = new Sprite(this.textures.idle[0]);
    this.sprite.anchor.set(0.5, 0.5);
    this.container.addChild(this.sprite);

    // Name label below sprite
    const rawName = agent.projectName || agent.id.slice(0, 8);
    const name = rawName.length > 14 ? rawName.slice(0, 12) + '..' : rawName;
    const labelStyle = new TextStyle({
      fontSize: 13,
      fontFamily: "'Segoe UI', 'Helvetica Neue', Arial, sans-serif",
      fill: COLORS.text,
      align: 'center',
      fontWeight: '600',
      dropShadow: {
        alpha: 0.8,
        blur: 2,
        color: 0x000000,
        distance: 1,
      },
    });
    this.nameLabel = new Text({ text: name, style: labelStyle });
    this.nameLabel.anchor.set(0.5, 0);
    this.nameLabel.position.set(0, this.spriteHeight / 2 + 6);
    this.container.addChild(this.nameLabel);

    // Speech bubble with background
    this.speechBubble = new Container();
    this.speechBubble.visible = false;

    this.speechBg = new Graphics();
    this.speechBubble.addChild(this.speechBg);

    this.speechPointer = new Graphics();
    this.speechBubble.addChild(this.speechPointer);

    const speechStyle = new TextStyle({
      fontSize: 10,
      fontFamily: "'Segoe UI', 'Helvetica Neue', Arial, sans-serif",
      fill: 0xe8f0ff,
      wordWrap: true,
      wordWrapWidth: BUBBLE_MAX_WIDTH - BUBBLE_PAD_X * 2,
      lineHeight: 14,
    });
    this.speechText = new Text({ text: '', style: speechStyle });
    this.speechText.anchor.set(0.5, 1);
    this.speechBubble.addChild(this.speechText);
    this.speechBubble.position.set(0, -this.spriteHeight / 2 - 8);
    this.container.addChild(this.speechBubble);

    // Spawn animation
    this.spawnAnimTimer = AgentSprite.SPAWN_ANIM_DURATION;
    this.container.scale.set(0.3);

    // Initial position
    this.targetX = 0;
    this.targetY = 0;
    this.baseY = 0;
    this.bobTimer = Math.random() * Math.PI * 2;
  }

  /** Move toward a world position */
  moveTo(x: number, y: number): void {
    this.targetX = x;
    this.targetY = y;
    this.isMoving = true;
  }

  /** Set speech with a queue of messages. Shows first, rotates through. */
  setSpeech(messages: SpeechMessage | SpeechMessage[]): void {
    const msgArray = Array.isArray(messages) ? messages : [messages];
    if (msgArray.length === 0 || (msgArray.length === 1 && !msgArray[0].text)) {
      this.clearSpeech();
      return;
    }

    this.speechQueue = msgArray.filter(m => m.text);
    if (this.speechQueue.length === 0) {
      this.clearSpeech();
      return;
    }

    this.currentSpeechIndex = 0;
    this.rotateTimer = 0;
    this.speechTimer = SPEECH_DURATION;
    this.showCurrentMessage();
  }

  /** Clear speech bubble */
  clearSpeech(): void {
    this.speechBubble.visible = false;
    this.speechTimer = 0;
    this.speechQueue = [];
    this.currentSpeechIndex = 0;
    this.needsInputPulse = 0;
  }

  private showCurrentMessage(): void {
    const msg = this.speechQueue[this.currentSpeechIndex];
    if (!msg) return;

    this.currentSpeechType = msg.type;
    const colors = BUBBLE_COLORS[msg.type];

    // Format text with icon prefix
    const icon = msg.icon || '';
    const prefix = icon ? `${icon} ` : '';
    const maxChars = 80;
    const rawText = prefix + msg.text;
    const display = rawText.length > maxChars ? rawText.slice(0, maxChars - 1) + '\u2026' : rawText;

    this.speechText.text = display;
    this.speechText.style.fill = colors.text;

    // Measure text to size background
    const textW = Math.min(this.speechText.width, BUBBLE_MAX_WIDTH - BUBBLE_PAD_X * 2);
    const textH = this.speechText.height;
    const bgW = textW + BUBBLE_PAD_X * 2;
    const bgH = textH + BUBBLE_PAD_Y * 2;

    // Draw rounded rect background
    this.speechBg.clear();
    this.speechBg
      .roundRect(-bgW / 2, -(bgH + POINTER_SIZE), bgW, bgH, BUBBLE_RADIUS)
      .fill({ color: colors.bg, alpha: 0.92 })
      .stroke({ color: colors.border, width: 1, alpha: 0.6 });

    // Draw pointer triangle
    this.speechPointer.clear();
    this.speechPointer
      .moveTo(-POINTER_SIZE, 0)
      .lineTo(0, POINTER_SIZE)
      .lineTo(POINTER_SIZE, 0)
      .closePath()
      .fill({ color: colors.bg, alpha: 0.92 });
    this.speechPointer.position.set(0, -(POINTER_SIZE + 1));

    // Position text centered in background
    this.speechText.position.set(0, -(POINTER_SIZE + BUBBLE_PAD_Y));

    this.speechBubble.visible = true;
    this.speechBubble.alpha = 1;
  }

  /** Set idle visual state */
  setIdle(idle: boolean): void {
    this.isIdleState = idle;
  }

  /** Update child count badge */
  setChildCount(count: number): void {
    if (count <= 0) {
      if (this.childBadge) {
        this.childBadge.visible = false;
      }
      return;
    }

    if (!this.childBadge) {
      this.childBadge = new Container();
      this.childBadgeBg = new Graphics();
      this.childBadge.addChild(this.childBadgeBg);

      this.childBadgeText = new Text({
        text: '',
        style: new TextStyle({
          fontSize: 9,
          fontFamily: "'Segoe UI', sans-serif",
          fill: 0xffffff,
          fontWeight: '700',
        }),
      });
      this.childBadgeText.anchor.set(0.5, 0.5);
      this.childBadge.addChild(this.childBadgeText);

      this.childBadge.position.set(this.spriteHeight / 2 - 4, -this.spriteHeight / 2 + 4);
      this.container.addChild(this.childBadge);
    }

    this.childBadgeText!.text = `${count}`;
    const r = 8;
    this.childBadgeBg!.clear();
    this.childBadgeBg!
      .circle(0, 0, r)
      .fill({ color: 0xab47bc })
      .stroke({ color: 0xffffff, width: 1, alpha: 0.5 });

    this.childBadge.visible = true;
  }

  /** Fade out and resolve when done */
  fadeOut(): Promise<void> {
    this.fadingOut = true;
    this.fadeTimer = FADE_OUT_DURATION;
    return new Promise<void>((resolve) => {
      this.fadeResolve = resolve;
    });
  }

  /** Per-frame update */
  update(dt: number): void {
    // Spawn animation (scale up)
    if (this.spawnAnimTimer > 0) {
      this.spawnAnimTimer -= dt;
      const t = 1 - Math.max(0, this.spawnAnimTimer / AgentSprite.SPAWN_ANIM_DURATION);
      // Elastic ease out
      const scale = 1 - Math.pow(2, -8 * t) * Math.cos(t * Math.PI * 3);
      this.container.scale.set(Math.max(0.3, scale));
    }

    // Handle fade out
    if (this.fadingOut) {
      this.fadeTimer -= dt;
      this.container.alpha = Math.max(0, this.fadeTimer / FADE_OUT_DURATION);
      if (this.fadeTimer <= 0) {
        this.fadingOut = false;
        this.fadeResolve?.();
        this.fadeResolve = null;
      }
      return;
    }

    // Movement
    if (this.isMoving) {
      this.updateMovement(dt);
    } else {
      this.updateBob(dt);
    }

    // Determine animation state
    if (this.isMoving) {
      this.animState = 'walk';
    } else if (this.isIdleState) {
      this.animState = 'idle';
    } else if (this.speechTimer > 0) {
      this.animState = 'working';
    } else {
      this.animState = 'idle';
    }

    // Animate sprite frames
    this.frameTimer += dt;
    const fps = this.animState === 'walk' ? WALK_FPS : IDLE_FPS;
    const frameDuration = 1000 / fps;

    if (this.animState === 'working') {
      this.sprite.texture = this.textures.working;
    } else {
      if (this.frameTimer >= frameDuration) {
        this.frameTimer -= frameDuration;
        this.frameIndex = (this.frameIndex + 1) % 2;
      }
      const frames = this.animState === 'walk' ? this.textures.walk : this.textures.idle;
      this.sprite.texture = frames[this.frameIndex];
    }

    // Speech bubble: rotation and timer
    if (this.speechTimer > 0) {
      this.speechTimer -= dt;

      // Rotate through queue
      if (this.speechQueue.length > 1) {
        this.rotateTimer += dt;
        if (this.rotateTimer >= SPEECH_ROTATE_DURATION) {
          this.rotateTimer = 0;
          this.currentSpeechIndex = (this.currentSpeechIndex + 1) % this.speechQueue.length;
          this.showCurrentMessage();
          this.speechTimer = SPEECH_DURATION; // reset timer on rotate
        }
      }

      // Input-needed pulse effect
      if (this.currentSpeechType === 'input-needed') {
        this.needsInputPulse += dt * 0.004;
        const pulseAlpha = 0.7 + 0.3 * Math.sin(this.needsInputPulse);
        this.speechBg.alpha = pulseAlpha;
        // Keep bubble visible longer for input-needed
        this.speechTimer = Math.max(this.speechTimer, 1000);
      } else {
        this.speechBg.alpha = 1;
      }

      // Fade out at end
      if (this.speechTimer <= SPEECH_FADE_DURATION && this.currentSpeechType !== 'input-needed') {
        this.speechBubble.alpha = Math.max(0, this.speechTimer / SPEECH_FADE_DURATION);
      }
      if (this.speechTimer <= 0 && this.currentSpeechType !== 'input-needed') {
        this.speechBubble.visible = false;
        this.speechTimer = 0;
        this.speechQueue = [];
      }
    }
  }

  private updateMovement(dt: number): void {
    const dtSec = dt / 1000;
    const dx = this.targetX - this.container.x;
    const dy = this.targetY - this.container.y;
    const dist = Math.sqrt(dx * dx + dy * dy);

    if (dist < ARRIVAL_THRESHOLD) {
      this.container.x = this.targetX;
      this.container.y = this.targetY;
      this.baseY = this.container.y;
      this.isMoving = false;
      return;
    }

    const step = Math.min(MOVE_SPEED * dtSec, dist);
    this.container.x += (dx / dist) * step;
    this.container.y += (dy / dist) * step;
  }

  private updateBob(dt: number): void {
    this.bobTimer += (dt / 1000) * BOB_SPEED * Math.PI * 2;
    this.container.y = this.baseY + Math.sin(this.bobTimer) * BOB_AMPLITUDE;
  }

  destroy(): void {
    this.container.destroy({ children: true });
  }
}
