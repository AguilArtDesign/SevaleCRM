import { useState } from 'react';
import {
  ColorArea,
  ColorField,
  ColorPicker,
  ColorSlider,
  ColorSwatch,
  ListBox,
} from '@heroui/react';
import { Select } from '../components/Select';

/** Color por defecto de una etiqueta nueva: el azul de acento del CRM. */
export const defaultTagColor = '#2563EB';

/** Los dos canales que se pueden escribir. El CRM no guarda HSB ni HSL, así que no se ofrecen. */
const channelSpaces = [
  { id: 'hex', label: 'HEX' },
  { id: 'rgb', label: 'RGB' },
] as const;

type ChannelSpace = (typeof channelSpaces)[number]['id'];

const rgbChannels = ['red', 'green', 'blue'] as const;

/**
 * Selector de color de las etiquetas. El disparador es solo el círculo: el nombre y el hexadecimal
 * ya se ven en el formulario que lo rodea.
 *
 * Dentro del desplegable se elige el canal —HEX escribe el color completo y RGB lo reparte en tres
 * campos—, que es lo único que el CRM guarda. El degradado y el tono son controles visuales: sin
 * ellos no habría forma de llegar a un color arbitrario.
 */
export function TagColorPicker({
  value,
  onChange,
  label = 'Color de la etiqueta',
}: {
  value: string;
  onChange: (hex: string) => void;
  label?: string;
}) {
  const [channelSpace, setChannelSpace] = useState<ChannelSpace>('hex');

  return (
    <ColorPicker value={value} onChange={(color) => onChange(color.toString('hex').toUpperCase())}>
      <ColorPicker.Trigger aria-label={`${label}: ${value}`}>
        <ColorSwatch size="md" />
      </ColorPicker.Trigger>
      <ColorPicker.Popover className="prospect-tag-color-popover">
        <ColorArea
          aria-label="Saturación y brillo"
          className="max-w-full"
          colorSpace="hsb"
          xChannel="saturation"
          yChannel="brightness"
        >
          <ColorArea.Thumb />
        </ColorArea>
        <ColorSlider
          aria-label="Tono"
          channel="hue"
          colorSpace="hsb"
          className="prospect-tag-color-hue"
        >
          <div className="prospect-tag-color-hue-head">
            <span className="prospect-tag-color-label">Tono</span>
            <ColorSlider.Output />
          </div>
          <ColorSlider.Track>
            <ColorSlider.Thumb />
          </ColorSlider.Track>
        </ColorSlider>
        <Select
          aria-label="Canal del color"
          variant="secondary"
          selectedKey={channelSpace}
          onSelectionChange={(key) => setChannelSpace(String(key) as ChannelSpace)}
        >
          <Select.Trigger>
            <Select.Value />
            <Select.Indicator />
          </Select.Trigger>
          <Select.Popover>
            <ListBox>
              {channelSpaces.map((space) => (
                <ListBox.Item key={space.id} id={space.id} textValue={space.label}>
                  {space.label}
                  <ListBox.ItemIndicator />
                </ListBox.Item>
              ))}
            </ListBox>
          </Select.Popover>
        </Select>
        {channelSpace === 'hex' ? (
          <ColorField aria-label="Color hexadecimal">
            <ColorField.Group variant="secondary">
              <ColorField.Input />
            </ColorField.Group>
          </ColorField>
        ) : (
          <div className="prospect-tag-color-channels">
            {rgbChannels.map((channel) => (
              <ColorField key={channel} aria-label={channel} channel={channel} colorSpace="rgb">
                <ColorField.Group variant="secondary">
                  <ColorField.Input />
                </ColorField.Group>
              </ColorField>
            ))}
          </div>
        )}
      </ColorPicker.Popover>
    </ColorPicker>
  );
}
