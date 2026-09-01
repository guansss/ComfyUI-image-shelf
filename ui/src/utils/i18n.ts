import i18n from 'i18next'
import LanguageDetector from 'i18next-browser-languagedetector'
import Backend from 'i18next-http-backend'
import { initReactI18next } from 'react-i18next'

interface TranslationResource {
  [language: string]: {
    [namespace: string]: {
      gallery: {
        title: string
        close: string
        search: string
        filters: string
        searchHelp: string
        searchSyntax: string
        groupByDay: string
        allImages: string
        addTab: string
        newTab: string
        tabName: string
        folderPath: string
        renameTab: string
        changeFolder: string
        removeTab: string
        removeTabMessage: string
        reindex: string
        reindexFailed: string
        reveal: string
        revealFailed: string
        metadataWarning: string
        dimensions: string
        creationDate: string
        fileSize: string
        tags: string
        negativeTags: string
        sort: string
        newest: string
        oldest: string
        filenameAscending: string
        filenameDescending: string
        pagination: string
        previous: string
        next: string
        page: string
        sendToFavorites: string
        favoriteSent: string
        favoriteFailed: string
        favoriteConflict: string
        favoriteConflictMessage: string
        loading: string
        error: string
        empty: string
        favoritesUnconfigured: string
      }
    }
  }
}

const fallbackResources: TranslationResource = {
  en: {
    main: {
      gallery: {
        title: 'Image Shelf',
        close: 'Close image shelf',
        search: 'Search tags and filenames',
        filters: 'Filters',
        searchHelp: 'Search syntax',
        searchSyntax: 'cat and tag:cat find positive tags. tag:-cat finds negative tags. -tag:cat excludes a positive tag. name:foo searches filenames. prompt:foo searches workflow text. Use quotes for spaces.',
        groupByDay: 'Group by creation day',
        allImages: 'All images',
        addTab: 'Add tab',
        newTab: 'New folder',
        tabName: 'Tab name',
        folderPath: 'Folder path',
        renameTab: 'Rename tab',
        changeFolder: 'Change folder',
        removeTab: 'Remove tab',
        removeTabMessage: 'Remove {{name}} from Image Shelf?',
        reindex: 'Re-index',
        reindexFailed: 'Could not start re-indexing',
        reveal: 'Reveal in file explorer',
        revealFailed: 'Could not reveal image',
        metadataWarning: 'Metadata warning',
        dimensions: 'Dimensions',
        creationDate: 'Creation date',
        fileSize: 'File size',
        tags: 'Tags',
        negativeTags: 'Negative tags',
        sort: 'Sort images',
        newest: 'Newest first',
        oldest: 'Oldest first',
        filenameAscending: 'Filename: A to Z',
        filenameDescending: 'Filename: Z to A',
        pagination: 'Gallery pagination',
        previous: 'Previous',
        next: 'Next',
        page: 'Page {{page}} of {{total}}',
        sendToFavorites: 'Send to Favorites',
        favoriteSent: 'Sent to Favorites',
        favoriteFailed: 'Could not send to Favorites',
        favoriteConflict: 'File already exists',
        favoriteConflictMessage: 'Choose a new filename or cancel.',
        loading: 'Loading images...',
        error: 'Could not load the image shelf.',
        empty: 'No images match this view.',
        favoritesUnconfigured: 'Set a Favorites folder in Image Shelf settings to browse favorites.'
      }
    }
  }
}

// Initialize i18next
void i18n
  // Load translations via http backend (must be first!)
  .use(Backend)
  // Detect user language
  .use(LanguageDetector)
  // Initialize react-i18next
  .use(initReactI18next)
  // Initialize i18next
  .init({
    debug: false,

    // Fallback language
    fallbackLng: 'en',

    // Namespace for translations
    ns: ['main'],
    defaultNS: 'main',

    // Do not load from bundled resources first
    initImmediate: true,

    saveMissing: false,

    // Language detection configuration
    detection: {
      // Order of detection methods
      order: ['navigator', 'htmlTag', 'path', 'subdomain'],
      // Don't cache detected language
      caches: []
    },

    // Backend configuration
    backend: {
      // Path to load translations from
      loadPath: '/locales/{{lng}}/{{ns}}.json',
      // Add retry logic
      requestOptions: {
        retry: 3,
        timeout: 3000
      }
    },

    // React specific options
    react: {
      useSuspense: true
    },

    // Allow string formatting for dynamic values
    interpolation: {
      escapeValue: false // Not needed for React as it escapes by default
    }
  })

i18n.on('failedLoading', (lng, ns) => {
  if (fallbackResources[lng] && fallbackResources[lng][ns]) {
    i18n.addResourceBundle(lng, ns, fallbackResources[lng][ns], true, true)
  }
})

export default i18n
