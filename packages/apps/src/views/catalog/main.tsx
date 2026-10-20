import { mountView } from '../../lib/mount.js';
import { CatalogCard } from './view.js';

mountView('catalog', { catalog: CatalogCard });
