// The parameter types are loose on purpose. Later changes replace `object` with
// the real plugin options and semantic-release context.
export function verifyConditions(pluginConfig: object, context: object): Promise<void>;
export function publish(pluginConfig: object, context: object): Promise<unknown>;
export function addChannel(pluginConfig: object, context: object): Promise<unknown>;
export function success(pluginConfig: object, context: object): Promise<void>;
export function fail(pluginConfig: object, context: object): Promise<void>;
