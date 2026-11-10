import { regularTemplateCards } from '../components/regularTemplateCards'
import type { TemplateCard } from '../components/templateCatalog'
import { latexTemplateCards } from '../latex/latexTemplateCards'
import { templateThumbnails, type TemplateThumbnail } from './templateThumbnails'

export const thumbnailKey = (card: Pick<TemplateCard, 'editor' | 'id'>) => `${card.editor}:${card.id}`

// Page counts come only from the measured real output; no thumbnail, no claim.
export const galleryCards: readonly TemplateCard[] = [...regularTemplateCards, ...latexTemplateCards].map((card) => {
  const thumbnail = templateThumbnails[thumbnailKey(card)]
  return thumbnail ? { ...card, pages: thumbnail.pages } : card
})

export function thumbnailFor(card: Pick<TemplateCard, 'editor' | 'id'>): TemplateThumbnail | null {
  return templateThumbnails[thumbnailKey(card)] ?? null
}
