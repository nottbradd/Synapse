import { layoutNetwork, type LayoutInput } from "./allNotesLayout";
self.onmessage = (event: MessageEvent<LayoutInput>) => {
  const result = layoutNetwork(event.data);
  self.postMessage(result, {
    transfer: [result.xy.buffer, result.community.buffer],
  });
};
