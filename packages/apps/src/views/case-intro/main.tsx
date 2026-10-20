import { mountView } from '../../lib/mount.js';
import { CaseIntroCard } from './view.js';
import { CatalogCard } from '../catalog/view.js';

mountView('case-intro', { 'case-intro': CaseIntroCard, catalog: CatalogCard });
