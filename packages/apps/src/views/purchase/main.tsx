import { mountView } from '../../lib/mount.js';
import { PurchaseCard } from './view.js';

mountView('purchase', { purchase: PurchaseCard });
