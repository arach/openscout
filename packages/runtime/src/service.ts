import type {
  ControlCommand,
  ControlEvent,
  DeliveryIntent,
  FlightRecord,
  InvocationRequest,
  MessageRecord,
} from "@openscout/protocol";

export interface ControlRuntime {
  dispatch(command: ControlCommand): Promise<void>;
  postMessage(message: MessageRecord): Promise<DeliveryIntent[]>;
  invokeAgent(invocation: InvocationRequest): Promise<FlightRecord>;
  subscribe(listener: (event: ControlEvent) => void): () => void;
}
