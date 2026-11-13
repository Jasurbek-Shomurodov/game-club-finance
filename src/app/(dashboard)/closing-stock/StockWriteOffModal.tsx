'use client';

import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { useTranslations } from 'next-intl';
import { PackageMinus, Trash2 } from 'lucide-react';
import {
  Badge,
  Button,
  Field,
  IconButton,
  InlineAlert,
  Input,
  Modal,
  Money,
  SegmentedControl,
  Select,
  Stepper,
} from '@/components/PresentationFoundation';
import { formatNumber } from '@/lib/formatters';
import { isWholeNumberInput, type ClosingStockRowData } from '@/lib/closingStock';
import {
  maxWriteOffQuantity,
  rowWriteOff,
  STOCK_WRITE_OFF_KINDS,
  type StockWriteOffKind,
} from '@/lib/stockWriteOffs';

export interface StockWriteOffInput {
  productId: string;
  kind: StockWriteOffKind;
  /** 0 removes the product's write-off for the day. */
  quantity: number;
  note: string;
}

interface StockWriteOffModalProps {
  open: boolean;
  /** Tracked, writable rows of the selected day. */
  rows: ClosingStockRowData[];
  saving: boolean;
  onClose: () => void;
  /** Resolves to an error message to show in the dialog, or `null` on success. */
  onSave: (writeOff: StockWriteOffInput) => Promise<string | null>;
}

/** Records units that went missing (kamomad) or spoiled (eskirgan) on the selected day. */
export function StockWriteOffModal({ open, rows, saving, onClose, onSave }: StockWriteOffModalProps) {
  const t = useTranslations('closingStock');
  const tc = useTranslations('common');
  const [productId, setProductId] = useState('');
  const [kind, setKind] = useState<StockWriteOffKind>('shortage');
  const [quantity, setQuantity] = useState('');
  const [note, setNote] = useState('');
  const [error, setError] = useState('');

  const rowsById = useMemo(() => new Map(rows.map((row) => [row.product.id, row])), [rows]);
  const sortedRows = useMemo(
    () => [...rows].sort((a, b) => a.product.name.localeCompare(b.product.name)),
    [rows],
  );
  const recorded = useMemo(() => sortedRows.flatMap((row) => {
    const writeOff = rowWriteOff(row);
    return writeOff ? [{ row, writeOff }] : [];
  }), [sortedRows]);

  useEffect(() => {
    if (!open) return;
    setProductId('');
    setKind('shortage');
    setQuantity('');
    setNote('');
    setError('');
  }, [open]);

  const selectedRow = rowsById.get(productId) ?? null;
  const existing = selectedRow ? rowWriteOff(selectedRow) : null;
  const available = selectedRow ? maxWriteOffQuantity(selectedRow) : 0;
  const quantityValue = Number(quantity || 0);
  const exceeds = selectedRow !== null && quantityValue > available;

  function selectProduct(value: string) {
    setProductId(value);
    setError('');
    const row = rowsById.get(value);
    const current = row ? rowWriteOff(row) : null;
    // Editing a product that already has a write-off today starts from it.
    setKind(current && current.kind !== 'other' ? current.kind : 'shortage');
    setQuantity(current ? String(current.quantity) : '');
    setNote(current?.note ?? '');
  }

  function updateQuantity(value: string) {
    if (!isWholeNumberInput(value)) return;
    setError('');
    setQuantity(value);
  }

  async function submit(input: StockWriteOffInput) {
    setError('');
    const saveError = await onSave(input);
    if (saveError) {
      setError(saveError);
      return false;
    }
    return true;
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedRow) {
      setError(t('writeOffProductRequired'));
      return;
    }
    if (quantityValue <= 0) {
      setError(t('writeOffQuantityRequired'));
      return;
    }
    if (exceeds) {
      setError(t('writeOffExceedsStock', { product: selectedRow.product.name, available: formatNumber(available) }));
      return;
    }
    if (await submit({ productId, kind, quantity: quantityValue, note })) onClose();
  }

  function kindLabel(value: string) {
    return value === 'shortage' || value === 'expired' ? t(`writeOffKinds.${value}`) : t('writeOffKinds.other');
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      locked={saving}
      title={t('writeOffTitle')}
      description={t('writeOffDescription')}
      size="lg"
      footer={(
        <div className="flex w-full flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button variant="outline" disabled={saving} onClick={onClose}>{tc('cancel')}</Button>
          <Button
            type="submit"
            form="stock-write-off-form"
            loading={saving}
            loadingLabel={tc('saving')}
            disabled={!selectedRow || quantityValue <= 0 || exceeds}
            icon={<PackageMinus size={16} aria-hidden="true" />}
          >
            {existing ? t('writeOffUpdate') : t('writeOffSave')}
          </Button>
        </div>
      )}
    >
      <form id="stock-write-off-form" onSubmit={handleSubmit} className="space-y-4">
        <Field label={t('product')} htmlFor="write-off-product" required>
          <Select
            id="write-off-product"
            value={productId}
            disabled={saving}
            onChange={(event) => selectProduct(event.target.value)}
          >
            <option value="">{t('writeOffChooseProduct')}</option>
            {sortedRows.map((row) => (
              <option key={row.product.id} value={row.product.id}>
                {row.product.name} · {t('bulkAvailable', { count: formatNumber(maxWriteOffQuantity(row)) })}
              </option>
            ))}
          </Select>
        </Field>

        <Field label={t('writeOffKind')}>
          <SegmentedControl
            label={t('writeOffKind')}
            options={STOCK_WRITE_OFF_KINDS.map((value) => ({ value, label: kindLabel(value) }))}
            value={kind}
            disabled={saving}
            onChange={setKind}
          />
        </Field>

        <Field
          label={t('writeOffQuantity')}
          hint={selectedRow ? t('bulkAvailable', { count: formatNumber(available) }) : undefined}
          error={exceeds && selectedRow ? t('writeOffExceedsStock', { product: selectedRow.product.name, available: formatNumber(available) }) : undefined}
        >
          <div className="flex flex-wrap items-center justify-between gap-3">
            <Stepper
              label={t('writeOffQuantity')}
              decreaseLabel={t('writeOffDecrease')}
              increaseLabel={t('writeOffIncrease')}
              value={quantity}
              max={selectedRow ? available : null}
              disabled={saving || !selectedRow}
              invalid={exceeds}
              onChange={updateQuantity}
              onStep={(delta) => updateQuantity(String(Math.max(0, quantityValue + delta)))}
            />
            {selectedRow && quantityValue > 0 && (
              <span className="text-sm text-gray-500">
                {t('writeOffLoss')}{' '}
                <span className="font-semibold text-danger-600">
                  <Money amount={quantityValue * Number(selectedRow.product.cost_price ?? 0)} />
                </span>
              </span>
            )}
          </div>
        </Field>

        <Field label={t('writeOffNote')} htmlFor="write-off-note">
          <Input
            id="write-off-note"
            value={note}
            maxLength={200}
            placeholder={t('writeOffNotePlaceholder')}
            disabled={saving}
            onChange={(event) => setNote(event.target.value)}
          />
        </Field>

        {error && <InlineAlert variant="danger">{error}</InlineAlert>}

        {recorded.length > 0 && (
          <div className="border-t border-gray-100 pt-4">
            <p className="mb-2 text-[13px] font-medium text-gray-700">{t('writeOffRecorded')}</p>
            <ul className="space-y-2">
              {recorded.map(({ row, writeOff }) => (
                <li key={row.product.id} className="flex items-center justify-between gap-3 rounded-xl border border-gray-100 p-3">
                  <div className="min-w-0">
                    <p className="truncate font-semibold text-gray-900">{row.product.name}</p>
                    <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-gray-500">
                      <Badge variant={writeOff.kind === 'expired' ? 'warning' : 'danger'} size="sm">{kindLabel(writeOff.kind)}</Badge>
                      <span>{formatNumber(writeOff.quantity)} {t('pcs')}</span>
                      <span className="font-medium text-danger-600">
                        <Money amount={writeOff.quantity * Number(row.product.cost_price ?? 0)} />
                      </span>
                      {writeOff.note && <span className="truncate">{writeOff.note}</span>}
                    </div>
                  </div>
                  <IconButton
                    variant="danger"
                    size="sm"
                    label={t('writeOffRemove', { product: row.product.name })}
                    icon={<Trash2 size={15} aria-hidden="true" />}
                    disabled={saving}
                    onClick={() => {
                      void submit({
                        productId: row.product.id,
                        kind: writeOff.kind === 'other' ? 'shortage' : writeOff.kind,
                        quantity: 0,
                        note: '',
                      }).then((ok) => {
                        if (ok && productId === row.product.id) selectProduct('');
                      });
                    }}
                  />
                </li>
              ))}
            </ul>
          </div>
        )}
      </form>
    </Modal>
  );
}
