import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';

import type { Account, Budget, CreditCard, ExternalDebt, Transaction, UpcomingExpense } from './types';

type ExportData = {
  accounts: Account[];
  cards: CreditCard[];
  transactions: Transaction[];
  upcoming: UpcomingExpense[];
  budgets: Budget[];
  debts: ExternalDebt[];
};

function csvCell(value: unknown) {
  return `"${String(value ?? '').replace(/"/g, '""')}"`;
}

export async function exportFinancialData(data: ExportData, format: 'json' | 'csv') {
  const date = new Date().toISOString().slice(0, 10);
  const file = new File(Paths.cache, `at-controle-financeiro-${date}.${format}`);
  file.create({ overwrite: true });
  if (format === 'json') {
    file.write(JSON.stringify({ exportedAt: new Date().toISOString(), currency: 'BRL', ...data }, null, 2));
  } else {
    const header = ['data', 'tipo', 'descricao', 'categoria', 'valor_centavos', 'registrado_por', 'status'];
    const rows = data.transactions.map((item) => [item.occurredAt, item.kind, item.description, item.category, item.amountCents, item.createdBy, item.syncStatus].map(csvCell).join(','));
    file.write([header.map(csvCell).join(','), ...rows].join('\n'));
  }
  if (await Sharing.isAvailableAsync()) {
    await Sharing.shareAsync(file.uri, { mimeType: format === 'json' ? 'application/json' : 'text/csv', dialogTitle: 'Exportar dados A&T' });
  }
  return file.uri;
}
