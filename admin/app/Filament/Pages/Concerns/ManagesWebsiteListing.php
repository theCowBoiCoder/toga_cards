<?php

namespace App\Filament\Pages\Concerns;

use Filament\Actions\Action;
use Filament\Forms\Components\Checkbox;
use Filament\Forms\Components\FileUpload;
use Filament\Forms\Components\Select;
use Filament\Forms\Components\TextInput;

trait ManagesWebsiteListing
{
    protected function shopAction(): Action
    {
        return $this->adminAction('listing')->label(fn (array $record): string => $record['shop_listed'] ? 'Edit shop' : 'List single on website')
            ->visible(fn (array $record): bool => ! empty($record['shop_card_id']))
            ->disabled(fn (array $record): bool => ! $record['shop_listed'] && $record['stock'] < 1)
            ->modalHeading(fn (array $record): string => $record['player'].' #'.$record['number'].' · Shop details')
            ->modalDescription(fn (array $record): string => 'Each unit is one single card. You own '.$record['stock'].' copies. Existing website listings are reused; use Stock to receive or count copies.')
            ->fillForm(fn (array $record): array => [
                'price' => $record['price'] === null ? null : $record['price'] / 100,
                'quantity' => $record['shop_listed'] ? $record['requested'] : min(1, $record['stock']),
                'sku' => $record['website_sku'],
                'condition' => $record['condition'],
                'photo_url' => str_starts_with($record['photo'], 'https://') ? $record['photo'] : '',
                'image' => str_starts_with($record['photo'], '/storage/') ? substr($record['photo'], 9) : null,
                'stockConfirmed' => false,
            ])
            ->schema([
                TextInput::make('sku')->label('SKU')->disabled()->dehydrated(false)
                    ->helperText('Assigned automatically to this single card and retained when you edit or restock it.'),
                $this->moneyInput('price', 'Selling price per card')->minValue(0.50),
                TextInput::make('quantity')->label('Copies to sell on the website')->integer()->minValue(fn (array $record): int => $record['shop_listed'] ? 0 : 1)
                    ->maxValue(fn (array $record): int => $record['stock'])->required()
                    ->helperText('Choose copies from your owned stock. Set 0 to stop offering this card. Confirmed copies become available immediately. Update eBay separately when you choose.'),
                Select::make('condition')->options(array_combine(
                    ['Not assessed', 'Near mint', 'Excellent', 'Very good', 'Good', 'Poor'],
                    ['Not assessed', 'Near mint', 'Excellent', 'Very good', 'Good', 'Poor'],
                ))->required(),
                FileUpload::make('image')->label('Card photo')->image()
                    ->acceptedFileTypes(['image/jpeg', 'image/png', 'image/webp'])->maxSize(5120)
                    ->disk('public')->directory('cards')->visibility('public'),
                TextInput::make('photo_url')->label('Or use a hosted HTTPS photo')->url()->maxLength(2000),
                Checkbox::make('stockConfirmed')->label('I have counted these physical copies and assessed their condition.'),
            ])
            ->action(function (array $data, array $record): void {
                $photo = filled($data['image'] ?? null) ? '/storage/'.$data['image'] : ($data['photo_url'] ?? '');
                $this->perform('/api/admin/shop', [
                    'action' => $record['shop_listed'] ? 'update' : 'create-single',
                    'cardId' => $record['shop_card_id'], 'price' => $this->pence($data['price']),
                    'quantity' => $data['quantity'], 'condition' => $data['condition'],
                    'photo' => $photo, 'stockConfirmed' => $data['stockConfirmed'],
                ], 'Shop details saved; website stock updated');
            });
    }

}
