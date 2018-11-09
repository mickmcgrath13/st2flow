// @flow
import type { JpathKey } from '@stackstorm/st2flow-yaml';

export type TransitionType = 'Success' | 'Error' | 'Complete';

export interface CanvasPoint {
    x: number;
    y: number
}

export interface TaskInterface {
    name: string;
    action: string;
    coords: CanvasPoint;

    size?: CanvasPoint;
    input?: Object;

    // Mistral only
    // workflow?: string;
    publish?: Array<Object>;

    // Orquesta only
    with?: ?{
        items: string,
        concurrency?: string,
    };
    join?: ?string;
}

export interface TaskRefInterface {
    name: string;
    workflow?: string;
}

export interface TransitionInterface {
    from: TaskRefInterface;
    to: Array<TaskRefInterface>;
    condition: ?string;

    // Mistral Only
    type?: TransitionType;

    // Orquesta Only
    publish?: Array<Object>;
}

export interface TransitionRefInterface {
    from: TaskRefInterface;
    to: Array<TaskRefInterface>;
    condition: ?string;
}

export interface ModelInterface {
    +version: number;
    +description: string;
    +tasks: Array<TaskInterface>;
    +transitions: Array<TransitionInterface>;
    +lastTaskIndex: number;

    constructor(yaml: string): void;
    fromYAML(yaml: string): void;
    toYAML(): string;

    // These intentionally return void to prevent chaining
    // Consumers are responsible for cleaning up after themselves
    on(event: string, callback: Function): void;
    removeListener(event: string, callback: Function): void;

    addTask(opts: TaskInterface): void;
    updateTask(ref: TaskRefInterface, newData: $Shape<TaskInterface>): void;
    deleteTask(ref: TaskRefInterface): void;

    setTaskProperty(task: TaskInterface, path: JpathKey, value: any): void;
    deleteTaskProperty(task: TaskInterface, path: JpathKey): void;

    addTransition(opts: TransitionInterface): void;
    updateTransition(oldTransition: TransitionInterface, newData: $Shape<TransitionInterface>): void;
    deleteTransition(transition: TransitionInterface): void;

    setTransitionProperty(transition: TransitionInterface, path: JpathKey, value: any): void;
    deleteTransitionProperty(transition: TransitionInterface, path: JpathKey): void;

    undo(): void;
    redo(): void;
}

export interface EditorPoint {
    row: number;
    column: number;
}

export interface DeltaInterface {
    start: EditorPoint;
    end: EditorPoint;
    action: 'insert' | 'remove';
    lines: Array<string>;
}

export type AjvError = {
    dataPath: string,
    keyword: string,
    message: string,
    params: Object,
}

export type GenericError = Error | {
    message: string
}
