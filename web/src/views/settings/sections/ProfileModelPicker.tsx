import { Plus, Search, X } from 'lucide-react';
import { inferModelVendor } from '../../../lib/providers';
import { TextInput } from '../ui';

export function parseModelIds(value: string): string[] {
  return value.split(/[,，\r\n]+/).map((id) => id.trim()).filter(Boolean);
}

interface ProfileModelPickerProps {
  models: string[];
  connected: ReadonlySet<string>;
  selected: string[];
  onSelect: (models: string[]) => void;
  query: string;
  onQuery: (query: string) => void;
  manualInput: string;
  onManualInput: (value: string) => void;
}

export function ProfileModelPicker({ models, connected, selected, onSelect, query, onQuery, manualInput, onManualInput }: ProfileModelPickerProps) {
  const checked = new Set(selected);
  const search = query.trim().toLowerCase();
  const filtered = models.map((id) => ({ id, vendor: inferModelVendor(id) }))
    .filter(({ id, vendor }) => id.toLowerCase().includes(search) || vendor?.toLowerCase().includes(search));
  const unselected = filtered.map((model) => model.id).filter((id) => !connected.has(id) && !checked.has(id));
  const add = (ids: string[]) => onSelect([...new Set([...selected, ...ids.filter((id) => !connected.has(id))])]);
  const remove = (id: string) => onSelect(selected.filter((value) => value !== id));
  const addManual = () => {
    add(parseModelIds(manualInput));
    onManualInput('');
  };

  return (
    <section className="api-span2 api-model-picker" aria-label="批量选择模型">
      {models.length > 0 && (
        <>
          <div className="api-select-tools">
            <div className="api-model-search">
              <Search size={15} aria-hidden />
              <TextInput type="search" placeholder="筛选模型…" aria-label="筛选模型" value={query}
                onChange={(event) => onQuery(event.target.value)} />
            </div>
            <button type="button" className="button" disabled={unselected.length === 0} onClick={() => add(unselected)}>全选当前</button>
          </div>
          <div className="api-model-options" role="group" aria-label="模型目录">
            {filtered.length === 0 && <p className="api-models-hint">未找到匹配的模型</p>}
            {filtered.map(({ id: modelId, vendor }) => {
              const alreadyConnected = connected.has(modelId);
              return (
                <label className="api-model-option" key={modelId}>
                  <input type="checkbox" aria-label={modelId} checked={alreadyConnected || checked.has(modelId)} disabled={alreadyConnected}
                    onChange={(event) => event.target.checked ? add([modelId]) : remove(modelId)} />
                  <code title={modelId}>{modelId}</code>
                  {alreadyConnected ? <span className="chip muted">已接入</span> : vendor && <span className="api-models-hint">{vendor}</span>}
                </label>
              );
            })}
          </div>
        </>
      )}
      <div className="api-manual-models">
        <TextInput value={manualInput} placeholder="输入模型 ID，用逗号或回车添加" aria-label="模型 ID"
          onChange={(event) => onManualInput(event.target.value)} onKeyDown={(event) => {
            if (!event.nativeEvent.isComposing && (event.key === 'Enter' || [',', '，'].includes(event.key))) {
              event.preventDefault();
              addManual();
            }
          }} />
        <button type="button" className="button" disabled={!manualInput.trim()} onClick={addManual}>
          <Plus size={14} aria-hidden /> 添加
        </button>
      </div>
      {selected.length > 0 && (
        <div className="api-selection" aria-label="已选模型">
          <div className="api-select-tools">
            <span className="api-models-hint" role="status">已选 {selected.length} 个模型</span>
            <button type="button" className="text-button" onClick={() => { onSelect([]); onManualInput(''); }}>清空</button>
          </div>
          <div className="api-selected-chips">
            {selected.map((modelId) => (
              <button type="button" key={modelId} className="chip muted" aria-label={`移除 ${modelId}`} onClick={() => remove(modelId)}>
                <code>{modelId}</code><X size={12} aria-hidden />
              </button>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}
