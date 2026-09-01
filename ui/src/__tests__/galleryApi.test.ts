import { fetchImages, fetchTagSuggestions } from '../galleryApi'

describe('gallery API client', () => {
  afterEach(() => {
    jest.clearAllMocks()
  })

  it('sends server-side gallery controls as query parameters', async () => {
    const fetchMock = window.fetch as jest.Mock
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ items: [], page: 2, page_size: 36, total: 40 })
    })

    await fetchImages(
      {
        tab: 'outputs',
        query: 'tag:cat',
        dimensions: ['512x512'],
        sort: 'filename',
        direction: 'asc',
        page: 2,
        pageSize: 36
      },
      '/api/image-shelf/v1'
    )

    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('tab=outputs'),
      expect.any(Object)
    )
    expect(fetchMock.mock.calls[0][0]).toContain('dimension=512x512')
    expect(fetchMock.mock.calls[0][0]).toContain('sort=filename')
  })

  it('uses the tab-scoped tag suggestion endpoint', async () => {
    const fetchMock = window.fetch as jest.Mock
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ items: [{ name: 'cat', type: 'positive' }] })
    })

    await expect(
      fetchTagSuggestions('favorites', 'ca', '/api/image-shelf/v1')
    ).resolves.toEqual([{ name: 'cat', type: 'positive' }])

    expect(fetchMock.mock.calls[0][0]).toContain('/tags?tab=favorites&q=ca')
  })
})