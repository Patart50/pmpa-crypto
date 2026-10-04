/** État d'interface partagé : formulaire ouvert, message éphémère. */
import type { TransactionType } from '../core/transactions';

class UiState {
  /** null : fermé ; 'new' : création ; sinon id de la transaction modifiée. */
  editing = $state<string | 'new' | null>(null);
  preset = $state<TransactionType | undefined>(undefined);
  toast = $state<string | null>(null);
  /** Le message en cours propose « Annuler » (D-053). */
  toastUndo = $state(false);
  /** Filtre à appliquer à l'ouverture de l'onglet Transactions (ex. depuis le Portefeuille). */
  txFilter = $state<'balance' | null>(null);
  importing = $state(false);
  private timer: ReturnType<typeof setTimeout> | undefined;

  create(type?: TransactionType): void {
    this.preset = type;
    this.editing = 'new';
  }

  edit(id: string): void {
    this.preset = undefined;
    this.editing = id;
  }

  close(): void {
    this.editing = null;
  }

  notify(message: string, options: { undo?: boolean } = {}): void {
    this.toast = message;
    this.toastUndo = options.undo === true;
    clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.toast = null;
      this.toastUndo = false;
    }, options.undo ? 8000 : 3500);
  }
}

export const ui = new UiState();
