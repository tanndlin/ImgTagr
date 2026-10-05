import { useState } from 'react'
import { deleteImages, downloadImages, type Image, type Profile } from './api'
import { useErrors } from './context/errors'
import { useStats } from './context/stats'
import { Dropzone } from './Dropzone'
import { Gallery } from './Gallery'
import { Header } from './Header'
import { useFilter } from './hooks/useFilter'
import { useImages } from './hooks/useImages'
import { usePicked } from './hooks/usePicked'
import { useTags } from './hooks/useTags'
import { useUploads } from './hooks/useUploads'
import { TAG_NAMES_LIST_ID } from './ImageTags'
import { Lightbox } from './Lightbox'
import { SelectionBar } from './SelectionBar'
import { TagFilter } from './TagFilter'
import { Toolbar } from './Toolbar'
import { UploadList } from './UploadList'

type Props = {
  profile: Profile
  onSignOut: () => void
}

function App({ profile, onSignOut }: Props) {
  const { error, reportError } = useErrors()
  const { refreshStats } = useStats()
  const {
    filter,
    searchInput,
    setSearchInput,
    setSort,
    setTagIds,
    toggleTag,
    toggleUntagged,
    clearTags,
  } = useFilter()
  const { images, hasMore, loadMore, sentinel, addUploaded, patchImageTags, removeImages } =
    useImages(filter)
  const { tags, refreshTags, tagImages, untagImage, renameTag, colorTag, deleteTag } = useTags({
    patchImageTags,
    setTagIds,
  })
  const { uploads, uploadFiles } = useUploads(addUploaded)
  const { picked, pickedImages, togglePick, pickAll, clearPicked, unpick } = usePicked(images)
  const [viewing, setViewing] = useState<string>()
  const viewingIndex = images.findIndex((i) => i.id === viewing)

  async function deletePicked(targets: Image[]) {
    const noun = targets.length === 1 ? 'this image' : `these ${targets.length} images`
    if (!confirm(`Permanently delete ${noun}?`)) {
      return
    }

    const ids = new Set(targets.map((i) => i.id))
    try {
      await deleteImages([...ids])
      removeImages(ids)
      unpick(ids)
    } catch (err) {
      reportError("Couldn't delete images", err)
    }

    refreshTags()
    refreshStats()
  }

  function emptyMessage() {
    if (filter.search) {
      return 'No images match your search.'
    }

    if (filter.untagged) {
      return 'Every image has a tag.'
    }

    return filter.tagIds.length ? 'No images have all of these tags.' : 'No images yet.'
  }

  return (
    <main>
      <Header profile={profile} onSignOut={onSignOut} />
      <Dropzone onFiles={uploadFiles} />
      <UploadList uploads={uploads} />
      {error && <p className="error">{error}</p>}

      <Toolbar search={searchInput} sort={filter.sort} onSearch={setSearchInput} onSort={setSort} />

      <TagFilter
        tags={tags}
        selected={filter.tagIds}
        untagged={filter.untagged}
        onToggle={toggleTag}
        onToggleUntagged={toggleUntagged}
        onClear={clearTags}
        onRename={renameTag}
        onColor={colorTag}
        onDelete={deleteTag}
      />

      <datalist id={TAG_NAMES_LIST_ID}>
        {tags.map((t) => (
          <option key={t.id} value={t.name} />
        ))}
      </datalist>

      {images.length === 0 && !error ? (
        <p className="empty">{emptyMessage()}</p>
      ) : (
        <Gallery
          images={images}
          picked={picked}
          picking={pickedImages.length > 0}
          onView={(image) => setViewing(image.id)}
          onPick={togglePick}
          onAddTag={(image, name) => tagImages([image], name)}
          onRemoveTag={untagImage}
        />
      )}
      {hasMore && <div ref={sentinel} aria-hidden="true" />}

      {viewingIndex !== -1 && (
        <Lightbox
          images={images}
          index={viewingIndex}
          onIndex={(index) => {
            setViewing(images[index].id)
            if (index >= images.length - 3) {
              loadMore()
            }
          }}
          onClose={() => setViewing(undefined)}
        />
      )}

      {pickedImages.length > 0 && (
        <SelectionBar
          images={pickedImages}
          total={images.length}
          onAddTag={(name) => tagImages(pickedImages, name)}
          onDownload={() => downloadImages(pickedImages.map((i) => i.id))}
          onDelete={() => deletePicked(pickedImages)}
          onSelectAll={pickAll}
          onClear={clearPicked}
        />
      )}
    </main>
  )
}

export default App
