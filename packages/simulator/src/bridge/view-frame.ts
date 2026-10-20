import { AppBridge, PostMessageTransport, type McpUiHostContext } from '@modelcontextprotocol/ext-apps/app-bridge';
import type { JSONRPCMessage, MessageExtraInfo, Transport, TransportSendOptions } from '@modelcontextprotocol/client';
import type { ResourceMeta } from '@alibi/host';
import { classifyUiMessage, isObjectFormMessage, type UiMessage } from './messages.js';

/**
 * Renders one MCP App view the way a web host must: an iframe on the sandbox
 * origin loads the view's HTML under the CSP its resource declares, and an
 * AppBridge speaks the MCP Apps protocol to it through that proxy.
 */

export type DisplayMode = 'inline' | 'fullscreen';

export interface ViewSpec {
  resourceUri: string;
  html: string;
  meta?: ResourceMeta;
  toolName: string;
  toolInput: Record<string, unknown>;
  toolResult: unknown;
}

export interface ViewCallbacks {
  /** A button in the view said something on the player's behalf, or asked to pay. */
  onMessage: (msg: UiMessage) => Promise<void> | void;
  onDisplayMode: (mode: DisplayMode) => DisplayMode;
  onCallTool: (name: string, args: Record<string, unknown>) => Promise<unknown>;
}

export interface MountedView {
  iframe: HTMLIFrameElement;
  /** Resolves once the view has initialized and received its tool result. */
  ready: Promise<void>;
  setContext(ctx: McpUiHostContext): void;
  teardown(): Promise<void>;
}

/**
 * Wraps the postMessage transport so the single-object `ui/message` form (the
 * one Alexa+ documents for purchases) is answered here; the bridge's schema
 * only accepts the array form, which still flows through it untouched.
 */
class ObjectMessageTransport implements Transport {
  onmessage?: (message: JSONRPCMessage, extra?: MessageExtraInfo) => void;
  onclose?: () => void;
  onerror?: (error: Error) => void;
  sessionId?: string;

  constructor(
    private inner: Transport,
    private handle: (params: unknown) => Promise<void>,
  ) {}

  async start(): Promise<void> {
    this.inner.onmessage = (message, extra) => {
      if (isObjectFormMessage(message)) {
        const { id, params } = message;
        this.handle(params).then(
          () => this.inner.send({ jsonrpc: '2.0', id, result: {} } as JSONRPCMessage),
          (err: unknown) => this.inner.send({ jsonrpc: '2.0', id, error: { code: -32603, message: String((err as Error)?.message ?? err) } } as JSONRPCMessage),
        );
        return;
      }
      this.onmessage?.(message, extra);
    };
    this.inner.onclose = () => this.onclose?.();
    this.inner.onerror = (e) => this.onerror?.(e);
    await this.inner.start();
  }

  send(message: JSONRPCMessage, options?: TransportSendOptions): Promise<void> {
    return this.inner.send(message, options);
  }

  close(): Promise<void> {
    return this.inner.close();
  }
}

export function mountView(container: HTMLElement, sandboxUrl: string, spec: ViewSpec, context: McpUiHostContext, cb: ViewCallbacks): MountedView {
  const iframe = document.createElement('iframe');
  // The proxy needs scripts and its own origin to host the inner frame; nothing else.
  iframe.setAttribute('sandbox', 'allow-scripts allow-same-origin allow-forms');
  iframe.title = 'Add-on view';
  iframe.src = sandboxUrl;
  container.append(iframe);

  const bridge = new AppBridge(null, { name: 'alibi-simulator', version: '0.1.0' }, { openLinks: {}, serverTools: {}, logging: {} }, { hostContext: context });

  let markReady!: () => void;
  const ready = new Promise<void>((r) => (markReady = r));

  bridge.onsandboxready = () => {
    const ui = spec.meta?.ui;
    void bridge.sendSandboxResourceReady({
      html: spec.html,
      ...(ui?.csp ? { csp: ui.csp } : {}),
      ...(ui?.permissions ? { permissions: ui.permissions } : {}),
    });
  };
  bridge.oninitialized = () => {
    void bridge.sendToolInput({ arguments: spec.toolInput });
    void bridge.sendToolResult(spec.toolResult as Parameters<AppBridge['sendToolResult']>[0]);
    markReady();
  };
  bridge.onmessage = async (params) => {
    await cb.onMessage(classifyUiMessage(params));
    return {};
  };
  bridge.onrequestdisplaymode = async ({ mode }) => ({ mode: cb.onDisplayMode(mode === 'fullscreen' ? 'fullscreen' : 'inline') });
  bridge.oncalltool = async (params) => (await cb.onCallTool(params.name, params.arguments ?? {})) as Awaited<ReturnType<NonNullable<AppBridge['oncalltool']>>>;
  bridge.onopenlink = async ({ url }) => {
    if (/^https:\/\//.test(url)) window.open(url, '_blank', 'noopener,noreferrer');
    return {};
  };
  bridge.onloggingmessage = (p) => console.debug('[view]', p.level, p.data);

  const transport = new ObjectMessageTransport(new PostMessageTransport(iframe.contentWindow!, iframe.contentWindow!), async (params) => {
    await cb.onMessage(classifyUiMessage(params));
  });
  void bridge.connect(transport);

  return {
    iframe,
    ready,
    setContext: (ctx) => bridge.setHostContext(ctx),
    async teardown() {
      try {
        await Promise.race([bridge.teardownResource({}), new Promise((r) => setTimeout(r, 400))]);
      } catch {
        // a view that never initialized has nothing to tear down
      }
      await bridge.close().catch(() => {});
      iframe.remove();
    },
  };
}
