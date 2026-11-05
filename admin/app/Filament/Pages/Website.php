<?php

namespace App\Filament\Pages;

use Filament\Forms\Components\Checkbox;
use Filament\Forms\Components\FileUpload;
use Filament\Forms\Components\Select;
use Filament\Forms\Components\TextInput;
use Filament\Tables\Columns\TextColumn;

class Website extends RecordsPage
{
    protected static ?string $title = 'Website listings';

    protected static ?string $navigationLabel = 'Website listings';

    protected static ?int $navigationSort = 20;

    protected function sourceRows(): array
    {
        $shop = $this->client()->get('/api/admin/shop');
        $targets = collect($shop['stockSync']['targets'])->keyBy('card_id');
        $listings = collect($shop['listings'])->keyBy('card_id');
        $cards = collect($this->client()->get('/api/inventory')['cards'])->keyBy('id');

        return collect($shop['products'])->map(fn (array $product): array => [...$product, 'stock' => $cards[$product['id']]['stock'], 'allocated' => $listings[$product['id']]['quantity'] ?? 0, 'requested' => $targets[$product['id']]['quantity'] ?? ($listings[$product['id']]['quantity'] ?? 0)])->all();
    }

    protected function columns(): array
    {
        return [TextColumn::make('player')->sortable(), TextColumn::make('number')->label('#'), TextColumn::make('variant'), TextColumn::make('stock')->label('Physical')->sortable(), TextColumn::make('requested')->label('Requested'), TextColumn::make('allocated')->label('Allocated'), TextColumn::make('available')->label('Purchasable'), TextColumn::make('price')->money('GBP', divideBy: 100)->placeholder('Not listed')];
    }

    protected function rowActions(): array
    {
        return [$this->adminAction('listing')->label('Edit listing')->fillForm(fn (array $record): array => ['price' => ($record['price'] ?? 99) / 100, 'quantity' => $record['requested'], 'condition' => $record['condition'], 'photo_url' => str_starts_with($record['photo'], 'https://') ? $record['photo'] : '', 'image' => str_starts_with($record['photo'], '/storage/') ? substr($record['photo'], 9) : null])
            ->schema([$this->moneyInput('price', 'Website price')->minValue(0.50), TextInput::make('quantity')->label('Website stock allocation')->integer()->minValue(0)->required(), Select::make('condition')->options(array_combine(['Not assessed', 'Near mint', 'Excellent', 'Very good', 'Good', 'Poor'], ['Not assessed', 'Near mint', 'Excellent', 'Very good', 'Good', 'Poor']))->required(),
                FileUpload::make('image')->label('Card photo')->image()->acceptedFileTypes(['image/jpeg', 'image/png', 'image/webp'])->maxSize(5120)->disk('public')->directory('cards')->visibility('public'), TextInput::make('photo_url')->label('Or use a hosted HTTPS photo')->url()->maxLength(2000), Checkbox::make('stockConfirmed')->label('I have counted these physical copies and assessed their condition.')])
            ->action(function (array $data, array $record): void {
                $photo = filled($data['image'] ?? null) ? '/storage/'.$data['image'] : ($data['photo_url'] ?? '');
                $this->perform('/api/admin/shop', ['cardId' => $record['id'], 'price' => $this->pence($data['price']), 'quantity' => $data['quantity'], 'condition' => $data['condition'], 'photo' => $photo, 'stockConfirmed' => $data['stockConfirmed']], 'Listing saved; stock verification may still be required');
            })];
    }
}
