<?php

namespace App\Filament\Pages;

use Filament\Forms\Components\Checkbox;
use Filament\Forms\Components\TextInput;
use Filament\Tables\Columns\IconColumn;
use Filament\Tables\Columns\TextColumn;

class Delivery extends RecordsPage
{
    protected static ?string $title = 'Delivery options';

    protected static ?int $navigationSort = 35;

    protected function sourceRows(): array
    {
        return $this->client()->get('/api/admin/shipping')['options'];
    }

    protected function columns(): array
    {
        return [TextColumn::make('name')->sortable(), TextColumn::make('price')->money('GBP', divideBy: 100)->sortable(), TextColumn::make('min_days')->label('From (working days)')->placeholder('Not specified'), TextColumn::make('max_days')->label('To (working days)')->placeholder('Not specified'), IconColumn::make('enabled')->boolean()->label('Enabled at checkout')];
    }

    protected function optionForm(): array
    {
        return [TextInput::make('name')->label('Delivery service name')->required()->maxLength(80), $this->moneyInput('price', 'Price per order'), TextInput::make('minDays')->label('Estimated minimum working days')->integer()->minValue(1)->maxValue(60)->nullable(), TextInput::make('maxDays')->label('Estimated maximum working days')->integer()->minValue(1)->maxValue(60)->nullable(), Checkbox::make('enabled')->label('Offer this delivery option at checkout')->default(false)];
    }

    protected function saveOption(array $data, ?string $id = null): void
    {
        $this->perform('/api/admin/shipping', [...$data, 'id' => $id, 'price' => $this->pence($data['price']), 'minDays' => filled($data['minDays'] ?? null) ? (int) $data['minDays'] : null, 'maxDays' => filled($data['maxDays'] ?? null) ? (int) $data['maxDays'] : null], 'Delivery option saved');
    }

    protected function getHeaderActions(): array
    {
        return [$this->adminAction('addDelivery')->label('Add delivery option')->schema($this->optionForm())->action(fn (array $data) => $this->saveOption($data))];
    }

    protected function rowActions(): array
    {
        return [$this->adminAction('editDelivery')->label('Edit')->fillForm(fn (array $record): array => ['name' => $record['name'], 'price' => $record['price'] / 100, 'minDays' => $record['min_days'], 'maxDays' => $record['max_days'], 'enabled' => (bool) $record['enabled']])->schema($this->optionForm())->action(fn (array $data, array $record) => $this->saveOption($data, $record['id']))];
    }
}
