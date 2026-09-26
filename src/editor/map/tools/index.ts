// Tool registry: one instance of every tool per room canvas.
import type { ToolId } from '../mapState';
import type { Tool, ToolHost } from './tool';
import { EntityTool } from './entityTool';
import { EyedropperTool, FillTool, RectTool, StrokeTool } from './paint';
import { SelectTool } from './select';
import { TerrainTool } from './terrain';

export interface ToolSet {
  get(id: ToolId): Tool;
  readonly select: SelectTool;
  readonly entity: EntityTool;
  dispose(): void;
}

export function createTools(host: ToolHost): ToolSet {
  const select = new SelectTool();
  const entity = new EntityTool(host);
  const all: Readonly<Record<ToolId, Tool>> = {
    pencil: new StrokeTool('pencil'),
    eraser: new StrokeTool('eraser'),
    rect: new RectTool(),
    fill: new FillTool(),
    eyedropper: new EyedropperTool(),
    select,
    terrain: new TerrainTool(),
    entity,
  };
  return { get: (id) => all[id], select, entity, dispose: () => entity.dispose() };
}
