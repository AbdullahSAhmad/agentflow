import type { JsonlMessage, ContentBlock, ToolUseBlock, TextBlock, ToolResultBlock } from '@agent-move/shared';

export interface ParsedActivity {
  type: 'tool_use' | 'text' | 'token_usage' | 'tool_result';
  toolName?: string;
  toolInput?: Record<string, unknown>;
  /** Unique tool_use block ID for correlating calls with results */
  toolUseId?: string;
  /** Tool result text (extracted from tool_result blocks) */
  toolResultText?: string;
  text?: string;
  inputTokens?: number;
  outputTokens?: number;
  cacheReadTokens?: number;
  cacheCreationTokens?: number;
  model?: string;
  sessionId?: string;
  /** Logical agent name discovered from SendMessage routing */
  agentName?: string;
  /** Sender name from <teammate-message teammate_id="X"> tags */
  messageSender?: string;
}

export class JsonlParser {
  parseLine(line: string): ParsedActivity[] {
    try {
      const msg: JsonlMessage = JSON.parse(line);
      return this.extractActivities(msg);
    } catch {
      return [];
    }
  }

  /**
   * Extract all activities from a single JSONL message.
   * Returns an array because a user message can contain tool results
   * AND a text block in the same assistant turn can have tool_use + text.
   */
  private extractActivities(msg: JsonlMessage): ParsedActivity[] {
    const sessionId = msg.sessionId;

    // Extract agent identity from SendMessage tool results (user messages)
    if (msg.toolUseResult?.routing?.sender) {
      const agentName = msg.toolUseResult.routing.sender;
      if (msg.message?.role === 'user' || msg.type === 'user') {
        return [{
          type: 'text',
          text: undefined,
          agentName,
          sessionId,
        }];
      }
    }

    // Parse <teammate-message> from user messages to extract sender identity
    if ((msg.message?.role === 'user' || msg.type === 'user') && msg.message?.content) {
      const content = typeof msg.message.content === 'string'
        ? msg.message.content
        : Array.isArray(msg.message.content)
          ? msg.message.content.map((b: any) => b.text ?? '').join('')
          : '';

      if (content.includes('<teammate-message')) {
        const senderMatch = content.match(/<teammate-message\s+teammate_id="([^"]+)"/);
        if (senderMatch) {
          return [{
            type: 'text',
            text: undefined,
            messageSender: senderMatch[1],
            sessionId,
          }];
        }
      }
    }

    // Extract tool results from user messages
    if (msg.message?.role === 'user' && Array.isArray(msg.message.content)) {
      const results: ParsedActivity[] = [];
      for (const block of msg.message.content) {
        if (block.type === 'tool_result') {
          const resultBlock = block as ToolResultBlock;
          const resultText = this.extractToolResultText(resultBlock);
          if (resultText) {
            results.push({
              type: 'tool_result',
              toolUseId: resultBlock.tool_use_id,
              toolResultText: resultText,
              sessionId,
            });
          }
        }
      }
      if (results.length > 0) return results;
    }

    // Only process messages that have a message with content array
    if (!msg.message?.content || !Array.isArray(msg.message.content)) {
      return [];
    }

    // Only process assistant messages for tools/text/tokens
    if (msg.message.role !== 'assistant') {
      return [];
    }

    const content = msg.message.content;
    const results: ParsedActivity[] = [];

    // Collect tool_use blocks
    for (const block of content) {
      if (block.type === 'tool_use') {
        const toolBlock = block as ToolUseBlock;
        results.push({
          type: 'tool_use',
          toolName: toolBlock.name,
          toolInput: toolBlock.input,
          toolUseId: toolBlock.id,
          model: msg.message.model,
          sessionId,
        });
      }
    }

    // If we found tool_use blocks, return them (prioritized)
    if (results.length > 0) return results;

    // Collect text blocks — capture ALL text, not just short ones
    for (const block of content) {
      if (block.type === 'text') {
        const textBlock = block as TextBlock;
        const text = textBlock.text.trim();
        if (text.length > 0) {
          results.push({
            type: 'text',
            text,
            model: msg.message.model,
            sessionId,
          });
        }
      }
    }

    if (results.length > 0) return results;

    // Extract token usage
    if (msg.message.usage) {
      return [{
        type: 'token_usage',
        inputTokens: msg.message.usage.input_tokens,
        outputTokens: msg.message.usage.output_tokens,
        cacheReadTokens: msg.message.usage.cache_read_input_tokens,
        cacheCreationTokens: msg.message.usage.cache_creation_input_tokens,
        model: msg.message.model,
        sessionId,
      }];
    }

    return [];
  }

  /** Extract readable text from a tool_result block */
  private extractToolResultText(block: ToolResultBlock): string {
    if (typeof block.content === 'string') {
      return block.content.length > 5000 ? block.content.slice(0, 5000) + '...' : block.content;
    }
    if (Array.isArray(block.content)) {
      const texts: string[] = [];
      for (const b of block.content) {
        if (b.type === 'text') {
          texts.push((b as TextBlock).text);
        }
      }
      const joined = texts.join('\n');
      return joined.length > 5000 ? joined.slice(0, 5000) + '...' : joined;
    }
    return '';
  }
}
