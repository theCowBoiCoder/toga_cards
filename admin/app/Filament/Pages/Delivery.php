<?php

namespace App\Filament\Pages;

use Filament\Forms\Components\Checkbox;
use Filament\Forms\Components\Repeater;
use Filament\Forms\Components\TextInput;
use Filament\Tables\Columns\IconColumn;
use Filament\Tables\Columns\TextColumn;

class Delivery extends RecordsPage
{
    protected static ?string $title = 'Delivery options';

    protected static ?int $navigationSort = 35;

    public function getSubheading(): ?string
    {
        return 'Charge once per basket. One protected card uses the single-card band; multiple cards share a parcel. Check packed size and weight before posting. Starter rates use Royal Mail online prices from 5 October 2026 plus 50p packaging. Edit limits to suit your packaging. Baskets above the last limit require a quote.';
    }

    protected function sourceRows(): array
    {
        return $this->client()->get('/api/admin/shipping')['options'];
    }

    protected function columns(): array
    {
        return [TextColumn::make('name')->sortable(), TextColumn::make('price')->label('Postage from')->money('GBP', divideBy: 100)->sortable(), TextColumn::make('packaging')->label('Packaging per order')->money('GBP', divideBy: 100), TextColumn::make('band_summary')->label('Combined postage bands')->state(fn (array $record): string => collect($record['bands'] ?? [])->map(fn (array $band): string => 'Up to '.$band['upToCards'].' cards: £'.number_format(($band['price'] + ($record['packaging'] ?? 0)) / 100, 2))->implode(' · ') ?: 'Flat rate'), TextColumn::make('min_days')->label('From (working days)')->placeholder('Not specified'), TextColumn::make('max_days')->label('To (working days)')->placeholder('Not specified'), IconColumn::make('enabled')->boolean()->label('Enabled at checkout')];
    }

    protected function optionForm(): array
    {
        return [
            TextInput::make('name')->label('Delivery service name')->required()->maxLength(80),
            $this->moneyInput('price', 'Flat postage price (used without bands)'),
            $this->moneyInput('packaging', 'Packaging allowance per order')->helperText('Added once. Include sleeves, holders and the mailer.'),
            Repeater::make('bands')->label('Combined postage bands')->schema([
                TextInput::make('upToCards')->label('Up to this many cards')->integer()->required()->minValue(1)->maxValue(1000000),
                $this->moneyInput('price', 'Postage for the whole basket'),
            ])->columns(2)->default([])->maxItems(20)->reorderable(false)->helperText('Use increasing card limits. Counts include duplicates across the whole basket. Above the last limit, customers must request a quote. Leave empty for flat postage.'),
            TextInput::make('minDays')->label('Estimated minimum working days')->integer()->minValue(1)->maxValue(60)->nullable(),
            TextInput::make('maxDays')->label('Estimated maximum working days')->integer()->minValue(1)->maxValue(60)->nullable(),
            Checkbox::make('enabled')->label('Offer this delivery option at checkout')->default(false),
        ];
    }

    protected function saveOption(array $data, ?string $id = null): void
    {
        $this->perform('/api/admin/shipping', [...$data, 'id' => $id, 'price' => $this->pence($data['price']), 'packaging' => $this->pence($data['packaging'] ?? 0), 'bands' => array_values(array_map(fn (array $band): array => ['upToCards' => (int) $band['upToCards'], 'price' => $this->pence($band['price'])], $data['bands'] ?? [])), 'minDays' => filled($data['minDays'] ?? null) ? (int) $data['minDays'] : null, 'maxDays' => filled($data['maxDays'] ?? null) ? (int) $data['maxDays'] : null], 'Delivery option saved');
    }

    protected function getHeaderActions(): array
    {
        return [$this->adminAction('addDelivery')->label('Add delivery option')->schema($this->optionForm())->action(fn (array $data) => $this->saveOption($data))];
    }

    protected function rowActions(): array
    {
        return [$this->adminAction('editDelivery')->label('Edit')->fillForm(fn (array $record): array => ['name' => $record['name'], 'price' => $record['price'] / 100, 'packaging' => ($record['packaging'] ?? 0) / 100, 'bands' => array_map(fn (array $band): array => ['upToCards' => $band['upToCards'], 'price' => $band['price'] / 100], $record['bands'] ?? []), 'minDays' => $record['min_days'], 'maxDays' => $record['max_days'], 'enabled' => (bool) $record['enabled']])->schema($this->optionForm())->action(fn (array $data, array $record) => $this->saveOption($data, $record['id']))];
    }
}
